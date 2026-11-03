// Table columns in the editor line up, however the rows were typed: before each cell's closing pipe, a
// blank space makes the cell as wide as the widest cell of its column, so an empty cell (`||`) keeps
// its column's width instead of letting the next pipe move up under the cell before. Display only: the
// file keeps the text as typed, and the cursor never enters the space (it stays at the end of the cell's
// text). Widths are counted in characters (CJK and emoji as two), so columns are exact with a
// monospaced font (the default) and close with others.

import { syntaxTree } from '@codemirror/language';
import { findClusterBreak, type Range } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { charEm } from './charWidth';

class Pad extends WidgetType {
  constructor(readonly width: number) {
    super();
  }
  override eq(other: Pad): boolean {
    return other.width === this.width;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-table-pad';
    span.style.width = `${this.width}em`;
    return span;
  }
  /** A click in the space is the editor's: it puts the cursor at the end of the cell's text. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/** Characters a terminal would give two columns: CJK, Hangul, full-width forms and pictographs. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/**
 * The closing pipe of each cell in a row, with the column (in characters) where it is drawn. Pipes are
 * found as the editor's table parser finds them (a backslash escapes one). The first pipe of a row that
 * starts with one opens the first cell and closes nothing.
 */
function closingPipes(text: string, tabSize: number): Array<{ at: number; col: number }> {
  const out: Array<{ at: number; col: number }> = [];
  let col = 0;
  let esc = false;
  let leading = true;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (c === 124 /* | */ && !esc) {
      if (!leading) out.push({ at: i, col });
      leading = false;
    } else if (c !== 32 && c !== 9) leading = false;
    esc = !esc && c === 92;
    const next = findClusterBreak(text, i);
    col = c === 9 ? col + tabSize - (col % tabSize) : col + (isWide(text.codePointAt(i)!) ? 2 : 1);
    i = next;
  }
  return out;
}

function build(view: EditorView, cw: number): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const decos: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Table') return;
        if (seen.has(node.from)) return false;
        seen.add(node.from);
        const rows: Array<{ from: number; pipes: Array<{ at: number; col: number }>; shift: number }> = [];
        for (let n = doc.lineAt(node.from).number, last = doc.lineAt(node.to).number; n <= last; n++) {
          const line = doc.line(n);
          rows.push({ from: line.from, pipes: closingPipes(line.text, state.tabSize), shift: 0 });
        }
        // Column by column: every row's pipe goes where the furthest one is, after the spaces added before it.
        for (let c = 0; ; c++) {
          let target = -1;
          for (const r of rows) if (r.pipes.length > c) target = Math.max(target, r.pipes[c].col + r.shift);
          if (target < 0) break;
          for (const r of rows) {
            if (r.pipes.length <= c) continue;
            const pad = target - (r.pipes[c].col + r.shift);
            if (pad <= 0) continue;
            r.shift += pad;
            decos.push(Decoration.widget({ widget: new Pad(Math.round(pad * cw * 10000) / 10000), side: 1 }).range(r.from + r.pipes[c].at));
          }
        }
        return false;
      },
    });
  }
  return Decoration.set(decos, true);
}

export const tableColumns = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** The measured character width, and the same in em of the font size it was measured at. */
    charWidth: number;
    cw: number;
    constructor(view: EditorView) {
      this.charWidth = view.defaultCharacterWidth;
      this.cw = charEm(view);
      this.decorations = build(view, this.cw);
    }
    update(u: ViewUpdate) {
      // A new measurement (another font) arrives as a geometry change; size alone is covered by em.
      const remeasured = u.geometryChanged && u.view.defaultCharacterWidth !== this.charWidth;
      if (remeasured) {
        this.charWidth = u.view.defaultCharacterWidth;
        this.cw = charEm(u.view);
      }
      if (remeasured || u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = build(u.view, this.cw);
    }
  },
  { decorations: (v) => v.decorations },
);
