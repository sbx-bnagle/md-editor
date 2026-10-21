// Markdown tables in the editor do not wrap: each row stays on one line, clipped at the edge of
// the text column, and the table scrolls sideways as a whole (trackpad, shift-scroll, or the
// scroll bar under its last row). The table follows the cursor while typing or moving.
//
// Rows are separate line elements, so each one scrolls; a shared offset per table keeps them
// aligned, and every row is made as wide as the widest (an absolutely placed pseudo-element sized
// by a per-table variable on the scroller, which CodeMirror does not manage), so all scroll as far.
// The cursor and selection are drawn in their own layers (drawSelection), which do not
// see these inner scrolls: they are redrawn after one, and clipped to the text column so a cursor
// scrolled out of view does not show beside it.

import { syntaxTree } from '@codemirror/language';
import { Annotation, RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

/** Marks the transaction that only redraws the cursor after a table scrolled. */
const redraw = Annotation.define<boolean>();
/** Space kept between the cursor and the edge of the column when the table follows it. */
const MARGIN = 24;

const widthVar = (key: number | string) => `--mde-table-${key}`;

function tableDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Table') return;
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = Math.max(first, lastLine + 1); n <= last; n++) {
          const cls = `cm-md-table${n === first ? ' cm-md-table-first' : ''}${n === last ? ' cm-md-table-last' : ''}`;
          const attributes = { 'data-table': String(node.from), style: `--mde-table-width: var(${widthVar(node.from)}, 0px)` };
          builder.add(doc.line(n).from, doc.line(n).from, Decoration.line({ class: cls, attributes }));
        }
        lastLine = Math.max(lastLine, last);
        return false;
      },
    });
  }
  return builder.finish();
}

class TableScroll {
  decorations: DecorationSet;
  /** Horizontal offset of each table, by the table's start position. */
  private offsets = new Map<number, number>();
  private frame = 0;

  constructor(readonly view: EditorView) {
    this.decorations = tableDecorations(view);
    view.contentDOM.addEventListener('scroll', this.onScroll, true);
    this.sync();
  }

  private rows(key: number): HTMLElement[] {
    return [...this.view.contentDOM.querySelectorAll<HTMLElement>(`.cm-md-table[data-table="${key}"]`)];
  }

  private setOffset(key: number, left: number, except?: HTMLElement) {
    this.offsets.set(key, left);
    for (const row of this.rows(key)) if (row !== except && row.scrollLeft !== left) row.scrollLeft = left;
  }

  private redrawCursor() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.view.dispatch({ selection: this.view.state.selection, annotations: redraw.of(true) }));
  }

  private onScroll = (e: Event) => {
    const row = e.target;
    if (!(row instanceof HTMLElement) || !row.classList.contains('cm-md-table')) return;
    const key = Number(row.dataset.table);
    if (this.offsets.get(key) === row.scrollLeft) return;
    this.setOffset(key, row.scrollLeft, row);
    this.redrawCursor();
  };

  update(u: ViewUpdate) {
    if (u.docChanged) {
      const moved = new Map<number, number>();
      for (const [key, left] of this.offsets) moved.set(u.changes.mapPos(key), left);
      this.offsets = moved;
    }
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = tableDecorations(u.view);
    const own = u.transactions.some((tr) => tr.annotation(redraw));
    if ((u.selectionSet || u.docChanged) && !own) this.followCursor();
    else this.sync();
  }

  /** Puts rows back at their table's offset (CodeMirror recreates line elements as it updates). */
  private sync() {
    this.view.requestMeasure({
      key: this,
      read: (view) => ({ clip: clipFor(view), widths: widthsFor(view) }),
      write: ({ clip, widths }, view) => {
        applyWidths(view, widths);
        for (const row of view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table')) {
          const want = this.offsets.get(Number(row.dataset.table)) ?? 0;
          if (row.scrollLeft !== want) row.scrollLeft = want;
        }
        applyClip(view, clip);
      },
    });
  }

  /** Scrolls the table holding the cursor so the cursor shows. */
  private followCursor() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const widths = widthsFor(view);
        const head = view.state.selection.main.head;
        const at = view.domAtPos(head).node;
        const row = (at instanceof HTMLElement ? at : at.parentElement)?.closest<HTMLElement>('.cm-md-table');
        const coords = row ? view.coordsAtPos(head) : null;
        if (!row || !coords) return { clip: clipFor(view), widths, follow: null };
        const box = row.getBoundingClientRect();
        let left = row.scrollLeft;
        if (coords.left < box.left + MARGIN) left -= box.left + MARGIN - coords.left;
        else if (coords.right > box.right - MARGIN) left += coords.right - (box.right - MARGIN);
        left = Math.max(0, Math.min(left, (widths.get(row.dataset.table ?? '') ?? row.scrollWidth) - row.clientWidth));
        return { clip: clipFor(view), widths, follow: { key: Number(row.dataset.table), left, changed: Math.abs(left - row.scrollLeft) > 0.5 } };
      },
      write: ({ clip, widths, follow }, view) => {
        applyWidths(view, widths);
        for (const row of view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table')) {
          const key = Number(row.dataset.table);
          const want = follow && follow.key === key ? follow.left : (this.offsets.get(key) ?? 0);
          if (row.scrollLeft !== want) row.scrollLeft = want;
        }
        if (follow) this.offsets.set(follow.key, follow.left);
        applyClip(view, clip);
        if (follow?.changed) this.redrawCursor();
      },
    });
  }

  destroy() {
    this.view.contentDOM.removeEventListener('scroll', this.onScroll, true);
    cancelAnimationFrame(this.frame);
  }
}

/** The scroll width of each drawn table (its widest row), by table key. */
function widthsFor(view: EditorView): Map<string, number> {
  const range = document.createRange();
  const out = new Map<string, number>();
  for (const row of view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table')) {
    // The text's own width (the pseudo-element is not part of the range).
    range.selectNodeContents(row);
    const style = getComputedStyle(row);
    const width = Math.ceil(range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight));
    const key = row.dataset.table ?? '';
    out.set(key, Math.max(out.get(key) ?? 0, width));
  }
  return out;
}

function applyWidths(view: EditorView, widths: Map<string, number>) {
  const style = view.scrollDOM.style;
  for (const name of [...style]) if (name.startsWith('--mde-table-') && !widths.has(name.slice('--mde-table-'.length))) style.removeProperty(name);
  for (const [key, width] of widths) if (style.getPropertyValue(widthVar(key)) !== `${width}px`) style.setProperty(widthVar(key), `${width}px`);
}

interface Clip {
  left: number;
  right: number;
}

/** The text column's horizontal extent, relative to the cursor and selection layers. */
function clipFor(view: EditorView): Clip | null {
  const layer = view.scrollDOM.querySelector<HTMLElement>('.cm-layer');
  if (!layer) return null;
  const origin = layer.getBoundingClientRect().left;
  const content = view.contentDOM.getBoundingClientRect();
  const style = getComputedStyle(view.contentDOM);
  return { left: content.left + parseFloat(style.paddingLeft) - origin - 2, right: content.right - parseFloat(style.paddingRight) - origin + 2 };
}

/** Clips the cursor and selection layers to the column (they have no size, so a polygon is used). */
function applyClip(view: EditorView, clip: Clip | null) {
  if (!clip) return;
  const value = `polygon(${clip.left}px -100000px, ${clip.right}px -100000px, ${clip.right}px 10000000px, ${clip.left}px 10000000px)`;
  for (const layer of view.scrollDOM.querySelectorAll<HTMLElement>('.cm-layer')) if (layer.style.clipPath !== value) layer.style.clipPath = value;
}

export const tableScroll = ViewPlugin.fromClass(TableScroll, { decorations: (v) => v.decorations });
