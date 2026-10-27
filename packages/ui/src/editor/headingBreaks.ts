// Line breaks in headings. A markdown heading is one line of the file, so Shift+Return in a heading
// writes <br> at the cursor. The editor shows each <br> in a heading as a grey backslash and continues
// the heading on the next row, under its text; the <br> is moved over and deleted as one unit.
// Display only: the file keeps the <br>.

import { syntaxTree } from '@codemirror/language';
import { Prec, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { charEm } from './charWidth';

const BREAK = /<br\s*\/?>/gi;
const HEADING_MARK = /^ {0,3}(#{1,6})([ \t]+|$)/;

/** The ATX heading the position is in, if any (not one inside code). */
function inHeading(view: EditorView, pos: number): boolean {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(pos, -1); n; n = n.parent as typeof n) {
    if (/^ATXHeading\d$/.test(n.name)) return true;
    if (n.name === 'InlineCode' || n.name === 'FencedCode' || n.name === 'CodeBlock') return false;
  }
  return false;
}

/** Shift+Return in a heading: a line break inside the heading instead of a new line. */
function insertHeadingBreak(view: EditorView): boolean {
  const { state } = view;
  // Every cursor must be in a heading's text, after its # marks.
  const inText = (head: number) => {
    const line = state.doc.lineAt(head);
    const mark = HEADING_MARK.exec(line.text);
    return !!mark && head >= line.from + mark[0].length && inHeading(view, head);
  };
  if (!state.selection.ranges.every((r) => inText(r.from) && inText(r.to))) return false;
  view.dispatch(state.replaceSelection('<br>'), { scrollIntoView: true, userEvent: 'input.type' });
  return true;
}

class BreakWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-heading-break';
    span.title = 'Line break (<br>)';
    const slash = document.createElement('span');
    slash.className = 'cm-heading-break-mark';
    slash.textContent = '\\';
    // The break itself, then an empty marker where the next row starts (for the cursor after the break).
    const start = document.createElement('span');
    start.className = 'cm-heading-break-next';
    span.append(slash, document.createElement('br'), start);
    return span;
  }
  /** Before the break: at the backslash. After it: at the start of the next row. */
  override coordsAt(dom: HTMLElement, pos: number) {
    const target = dom.querySelector(pos > 0 ? '.cm-heading-break-next' : '.cm-heading-break-mark');
    const rect = target?.getBoundingClientRect();
    return rect ? { left: rect.left, right: rect.left, top: rect.top, bottom: rect.bottom } : null;
  }
  override ignoreEvent() {
    return false;
  }
}

const breakWidget = Decoration.replace({ widget: new BreakWidget() });

function build(view: EditorView, cw: number): { decorations: DecorationSet; breaks: DecorationSet } {
  const decos: Range<Decoration>[] = [];
  const breaks: Range<Decoration>[] = [];
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      const mark = HEADING_MARK.exec(line.text);
      if (!mark || !line.text.toLowerCase().includes('<br')) continue;
      const found: Array<[number, number]> = [];
      for (const m of line.text.matchAll(BREAK)) {
        const at = line.from + m.index;
        // Only <br> written as HTML in the heading's text (not in code or an attribute). resolve, not
        // resolveInner: the tag's own HTML parse is nested inside the markdown HTMLTag node.
        const node = syntaxTree(view.state).resolve(at + 1, 1);
        if (node.name === 'HTMLTag' && inHeading(view, at + 1)) found.push([at, at + m[0].length]);
      }
      if (!found.length) continue;
      // Rows after a break start under the heading's text, like wrapped list items.
      const indent = Math.round(mark[0].length * cw * 10000) / 10000;
      decos.push(Decoration.line({ class: 'cm-heading-broken', attributes: { style: `--heading-indent: ${indent}em` } }).range(line.from));
      for (const [a, b] of found) {
        decos.push(breakWidget.range(a, b));
        breaks.push(breakWidget.range(a, b));
      }
    }
  }
  return { decorations: Decoration.set(decos, true), breaks: Decoration.set(breaks, true) };
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    breaks: DecorationSet;
    charWidth: number;
    cw: number;
    constructor(view: EditorView) {
      this.charWidth = view.defaultCharacterWidth;
      this.cw = charEm(view);
      ({ decorations: this.decorations, breaks: this.breaks } = build(view, this.cw));
    }
    update(u: ViewUpdate) {
      const remeasured = u.geometryChanged && u.view.defaultCharacterWidth !== this.charWidth;
      if (remeasured) {
        this.charWidth = u.view.defaultCharacterWidth;
        this.cw = charEm(u.view);
      }
      if (remeasured || u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        ({ decorations: this.decorations, breaks: this.breaks } = build(u.view, this.cw));
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // The cursor moves over a <br> in one step, and Backspace or Delete removes all of it.
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.breaks ?? Decoration.none),
  },
);

export const headingBreaks = [plugin, Prec.high(keymap.of([{ key: 'Shift-Enter', run: insertHeadingBreak }]))];
