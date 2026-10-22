import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { EditorSelection, type EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import {
  curlyQuote,
  frontMatterRange,
  isContentBlockLine,
  isInsideCodeSpan,
  isInsideHtmlTag,
  isInsideLinkTarget,
  isInsideVariable,
  smartDash,
  smartenMarkdown,
} from '@mde/core';

// Code and markup nodes. Inside a block one, quotes stay straight up to its end; an inline one
// (a tag, a code span, a URL) ends where it ends, so a quote typed right after it is prose.
const BLOCK_CODE = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock']);
const INLINE_CODE = new Set(['InlineCode', 'CodeText', 'CodeMark', 'CodeInfo', 'HTMLTag', 'Comment', 'ProcessingInstruction', 'URL', 'LinkTitle']);

function inCodeNode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (BLOCK_CODE.has(node.name)) return true;
    if (INLINE_CODE.has(node.name) && pos > node.from && pos < node.to) return true;
  }
  return false;
}

/** Front matter, also while it is being written (an opening --- with no closing one yet). */
function inFrontMatter(state: EditorState, pos: number): boolean {
  const head = state.doc.sliceString(0, Math.min(state.doc.length, 20000));
  const fm = frontMatterRange(head);
  if (fm) return pos < fm[1];
  // Until the first blank line: a --- rule at the top of a document is not front matter.
  return /^---[ \t]*(\n|$)/.test(head) && pos > 3 && !head.slice(0, pos).includes('\n\n');
}

/** True when a straight quote typed at `pos` should stay straight. */
export function keepStraight(state: EditorState, pos: number, typed: string): boolean {
  if (inFrontMatter(state, pos)) return true;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  if (isInsideHtmlTag(before) || isInsideVariable(before) || isInsideCodeSpan(before) || isInsideLinkTarget(before)) return true;
  if (isContentBlockLine(before.trimEnd()) || isContentBlockLine(before + typed)) return true;
  return inCodeNode(state, pos);
}

/** Text before `pos` on its line (the last part of it), which decides a quote's direction. */
function lineBefore(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos);
  return state.doc.sliceString(Math.max(line.from, pos - 200), pos);
}

export const smartQuotes = [
  EditorView.inputHandler.of((view, _from, _to, text) => {
    if ((text !== '-' && text !== '"' && text !== "'") || view.state.readOnly) return false;
    const { state } = view;
    let changed = false;
    // Every selection gets the same treatment (several cursors type together).
    const tr = state.changeByRange((range) => {
      const { from, to } = range;
      if (text === '-') {
        const line = state.doc.lineAt(from);
        const dash = from === to && !keepStraight(state, from, text) ? smartDash(line.text.slice(0, from - line.from), line.text.slice(to - line.from)) : null;
        if (dash) {
          changed = true;
          return { changes: { from: from - 1, to, insert: dash }, range: EditorSelection.cursor(from - 1 + dash.length) };
        }
        return { changes: { from, to, insert: text }, range: EditorSelection.cursor(from + text.length) };
      }
      const insert = keepStraight(state, from, text) ? text : curlyQuote(text as '"' | "'", lineBefore(state, from));
      if (insert !== text) changed = true;
      return { changes: { from, to, insert }, range: EditorSelection.cursor(from + insert.length) };
    });
    if (!changed) return false;
    view.dispatch(state.update(tr, { userEvent: 'input.type', scrollIntoView: true }));
    return true;
  }),
  EditorView.clipboardInputFilter.of((text, state) => {
    if (!/["']|--/.test(text)) return text;
    const pos = state.selection.main.from;
    if (keepStraight(state, pos, '')) return text;
    return smartenMarkdown(text, pos === 0, lineBefore(state, pos));
  }),
];

/** Converts straight quotes and -- / --- in the document (outside code, tags, front matter). */
export function convertAllQuotes(view: EditorView): number {
  const text = view.state.doc.toString();
  const out = smartenMarkdown(text, true);
  if (out === text) return 0;
  // Conversions are local: one quote for one quote, one dash for two or three hyphens.
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let i = 0;
  let j = 0;
  while (i < text.length && j < out.length) {
    if (text[i] === out[j]) {
      i++;
      j++;
      continue;
    }
    const len = out[j] === '\u2014' && text.startsWith('---', i) ? 3 : out[j] === '\u2013' && text.startsWith('--', i) ? 2 : 1;
    changes.push({ from: i, to: i + len, insert: out[j] });
    i += len;
    j++;
  }
  view.dispatch({ changes, userEvent: 'input.quotes' });
  return changes.length;
}
