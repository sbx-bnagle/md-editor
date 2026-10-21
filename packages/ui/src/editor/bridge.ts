// Gives non-React code (actions, menus) access to the active CodeMirror view.

import { EditorView } from '@codemirror/view';
import { splitFrontMatter, type AuthorSpan } from '@mde/core';
import { authorSpans } from './authorship';
import { convertAllQuotes } from './smartQuotes';

let view: EditorView | null = null;

export const editorBridge = {
  attach(v: EditorView | null) {
    view = v;
  },
  get view() {
    return view;
  },
  getText(): string | null {
    return view ? view.state.doc.toString() : null;
  },
  getSpans(): AuthorSpan[] {
    return view?.state.field(authorSpans, false) ?? [];
  },
  /** Source line (0-based) at the top of the editor, plus the fraction of it scrolled past. */
  topLine(): number {
    if (!view) return 0;
    const height = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    const block = view.lineBlockAtHeight(Math.max(0, height));
    const frac = block.height > 0 ? Math.min(1, Math.max(0, (height - block.top) / block.height)) : 0;
    return view.state.doc.lineAt(block.from).number - 1 + frac;
  },
  /** Scrolls so that a source line (0-based, fractional as from topLine) is at the top. */
  scrollToLine(line: number): void {
    if (!view) return;
    const n = Math.min(view.state.doc.lines, Math.max(1, Math.floor(line) + 1));
    const from = view.state.doc.line(n).from;
    const frac = Math.max(0, line - Math.floor(line));
    // CodeMirror estimates the height of lines it has not drawn; scrollIntoView corrects for that
    // once they are measured. The fraction into a long (wrapped) line is applied afterwards.
    view.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'start', yMargin: 0 }) });
    if (frac > 0) {
      view.requestMeasure({
        read: (v) => v.lineBlockAt(from).height,
        write: (height, v) => {
          v.scrollDOM.scrollTop += frac * height;
        },
      });
    }
  },
  focus() {
    view?.focus();
  },
  /** Inserts a line as its own paragraph after the cursor's line (or in place of an empty line). */
  insertBlockLine(text: string): void {
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    if (line.text.trim() === '') {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, selection: { anchor: line.from + text.length } });
    } else {
      const next = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : null;
      const insert = `\n\n${text}${next && next.text.trim() !== '' ? '\n' : ''}`;
      view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + 2 + text.length } });
    }
    view.focus();
  },
  convertQuotes(): number {
    return view ? convertAllQuotes(view) : 0;
  },
  /** Sets or removes a front matter key (used for per-document theme selection). */
  setFrontMatterValue(key: string, value: string | null): void {
    if (!view) return;
    const text = view.state.doc.toString();
    const fm = splitFrontMatter(text);
    const line = `${key}: ${value}`;
    if (!fm.present) {
      if (value === null) return;
      view.dispatch({ changes: { from: 0, insert: `---\n${line}\n---\n\n` } });
      return;
    }
    const head = text.slice(0, fm.bodyOffset);
    const re = new RegExp(`^${key}[ \\t]*:.*$\\n?`, 'm');
    const m = re.exec(head);
    if (m) {
      const from = m.index;
      const to = m.index + m[0].length;
      view.dispatch({ changes: { from, to, insert: value === null ? '' : `${line}\n` } });
    } else if (value !== null) {
      const insertAt = head.indexOf('\n') + 1;
      view.dispatch({ changes: { from: insertAt, insert: `${line}\n` } });
    }
  },
};
