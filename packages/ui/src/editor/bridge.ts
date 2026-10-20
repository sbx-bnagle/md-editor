// Gives non-React code (actions, menus) access to the active CodeMirror view.

import type { EditorView } from '@codemirror/view';
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
  topLine(): number {
    if (!view) return 0;
    const block = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.scrollTop));
    return view.state.doc.lineAt(block.from).number - 1;
  },
  focus() {
    view?.focus();
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
