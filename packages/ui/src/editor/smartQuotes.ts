import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import {
  curlyQuote,
  frontMatterRange,
  isContentBlockLine,
  isInsideCodeSpan,
  isInsideHtmlTag,
  isInsideVariable,
  smartDash,
  smartenMarkdown,
} from '@mde/core';

const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'CodeMark', 'CodeInfo', 'HTMLTag', 'HTMLBlock', 'Comment', 'CommentBlock', 'ProcessingInstruction', 'URL']);

function inCodeNode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true;
  }
  return false;
}

/** True when a straight quote typed at `pos` should stay straight. */
export function keepStraight(state: EditorState, pos: number, typed: string): boolean {
  const fm = frontMatterRange(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
  if (fm && pos < fm[1]) return true;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  if (isInsideHtmlTag(before) || isInsideVariable(before) || isInsideCodeSpan(before)) return true;
  if (isContentBlockLine(before.trimEnd()) || isContentBlockLine(before + typed)) return true;
  return inCodeNode(state, pos);
}

export const smartQuotes = [
  EditorView.inputHandler.of((view, from, to, text) => {
    if (text === '-' && from === to && !view.state.readOnly && !keepStraight(view.state, from, text)) {
      const line = view.state.doc.lineAt(from);
      const dash = smartDash(line.text.slice(0, from - line.from));
      if (!dash) return false;
      view.dispatch({ changes: { from: from - 1, to, insert: dash }, selection: { anchor: from }, userEvent: 'input.type', scrollIntoView: true });
      return true;
    }
    if (text !== '"' && text !== "'") return false;
    if (view.state.readOnly || keepStraight(view.state, from, text)) return false;
    const prev = from > 0 ? view.state.doc.sliceString(from - 1, from) : undefined;
    const curly = curlyQuote(text, prev);
    view.dispatch({
      changes: { from, to, insert: curly },
      selection: { anchor: from + curly.length },
      userEvent: 'input.type',
      scrollIntoView: true,
    });
    return true;
  }),
  EditorView.clipboardInputFilter.of((text, state) => {
    if (!/["']|--/.test(text)) return text;
    const pos = state.selection.main.from;
    if (keepStraight(state, pos, '')) return text;
    return smartenMarkdown(text, pos === 0);
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
