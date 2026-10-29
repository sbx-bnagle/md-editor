// Lists in the editor: each marker starts at the text's left edge (a nested one at its parent's text edge),
// and item text, wrapped rows and continuation lines included, starts at one shared indent. The indent is
// three characters; a list with wider markers ("10.") uses the widest marker plus a space for all of its
// items. Display only: the file keeps the spaces as typed. Lists inside block quotes are left as they are.
//
// Only line styles and a margin after the marker are used: every typed character stays in the text as
// it is, so the cursor, selection and typing work as on any line. (Hidden spaces and inline-block
// markers, used before 0.9.9, put typed text in the wrong place and broke mouse selection.) The widths
// are counted in characters, so the edge is exact with a monospaced font and close with others.

import { syntaxTree } from '@codemirror/language';
import { countColumn, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { frontMatterRange } from '@mde/core';
import { charEm } from './charWidth';

/** Indent of item text, in characters. */
const STEP = 3;

/**
 * A line of a list. `edge`: where the item's text starts (and wrapped rows); `first`: where the line's
 * first row starts, so that the typed spaces before the marker or text end where they should.
 */
const lineDeco = (cls: string, edge: number, first: number) => Decoration.line({ class: cls, attributes: { style: `--list-edge: ${edge}em; --list-first: ${first}em` } });

/** Spaces after a marker that belong to it (1–4; with 5 or more, the content is code and one space counts). */
function gapAfter(text: string, at: number): number {
  let n = 0;
  while (text[at + n] === ' ') n++;
  return n > 4 ? 1 : n;
}

function build(view: EditorView, cw: number): DecorationSet {
  const { state } = view;
  const em = (chars: number) => Math.round(chars * cw * 10000) / 10000;
  const tree = syntaxTree(state);
  const fm = frontMatterRange(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
  const steps = new Map<number, number>();
  const stepOf = (list: SyntaxNode): number => {
    let step = steps.get(list.from);
    if (step === undefined) {
      let widest = 0;
      for (let item = list.firstChild; item; item = item.nextSibling) {
        const mark = item.getChild('ListMark');
        if (mark) widest = Math.max(widest, mark.to - mark.from);
      }
      step = Math.max(STEP, widest + 1);
      steps.set(list.from, step);
    }
    return step;
  };
  /** Where an item's marker and text start, in characters; null inside a block quote. */
  const layout = (item: SyntaxNode): { indent: number; edge: number } | null => {
    let indent = 0;
    for (let n = item.parent?.parent ?? null; n; n = n.parent) {
      if (n.name === 'Blockquote') return null;
      if (n.name === 'ListItem' && n.parent) indent += stepOf(n.parent);
    }
    return item.parent ? { indent, edge: indent + stepOf(item.parent) } : null;
  };

  const decos: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (fm && line.from < fm[1]) continue;
      const ws = /^[ \t]*/.exec(line.text)![0].length;
      if (ws === line.text.length) continue;
      let item: SyntaxNode | null = tree.resolveInner(line.from + ws, 1);
      while (item && item.name !== 'ListItem') item = item.parent;
      const mark = item?.getChild('ListMark');
      const place = item && mark ? layout(item) : null;
      if (!item || !mark || !place) continue;
      const markLine = state.doc.lineAt(mark.from);
      const gap = gapAfter(markLine.text, mark.to - markLine.from);
      // Columns taken by the typed indentation (a tab counts to the next tab stop).
      const wsColumns = countColumn(line.text.slice(0, ws), state.tabSize);
      if (markLine.number === line.number) {
        if (mark.from !== line.from + ws) continue;
        // The first row starts where the typed spaces end at the marker's place.
        decos.push(lineDeco('cm-list-line', em(place.edge), em(place.indent - wsColumns)).range(line.from));
        // After the marker and its spaces, the text starts at the edge: the marker's margin makes up the difference.
        const shift = place.edge - place.indent - (mark.to - mark.from) - gap;
        if (shift) decos.push(Decoration.mark({ class: 'cm-list-mark', attributes: { style: `margin-right: ${em(shift)}em` } }).range(mark.from, mark.to));
      } else {
        // A continuation line of the item: its text lines up with the item's text; spaces past the
        // item's content column (code inside the item) still show.
        const contentColumn = mark.to - markLine.from + Math.max(gap, 1);
        decos.push(lineDeco('cm-list-cont', em(place.edge), em(place.edge - Math.min(wsColumns, contentColumn))).range(line.from));
      }
    }
  }
  return Decoration.set(decos, true);
}

export const listIndent = ViewPlugin.fromClass(
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
  // Outer decorations, so the marker's element stays in one piece under other marks (spelling, authorship).
  { provide: (plugin) => EditorView.outerDecorations.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none) },
);
