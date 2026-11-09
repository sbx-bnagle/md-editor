// Line numbers in the markdown editor, in the margin just left of the text column (the column is
// centred, so the editor's own left edge can be far from the text). They show while the pointer is
// over that margin, or always with View › Line Numbers (the `line-numbers` class on the editor host).
//
// CodeMirror's line-number gutter is used, made as wide as the space left of the text and given a
// negative margin of the same width, so it takes no room: the column stays where it was. The gutter
// lets the pointer through (a click or drag there still reaches the text), so the hover is followed
// from the scroller's own mouse movements.

import { ViewPlugin, lineNumbers, type EditorView, type ViewUpdate } from '@codemirror/view';

const placeNumbers = ViewPlugin.fromClass(
  class {
    /** Distance from the scroller's left edge to the start of the text, in px. */
    left = 0;
    hover = false;
    constructor(readonly view: EditorView) {
      view.scrollDOM.addEventListener('mousemove', this.onMove);
      view.scrollDOM.addEventListener('mouseleave', this.onLeave);
      this.measure();
    }
    update(u: ViewUpdate) {
      if (u.geometryChanged) this.measure();
    }
    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const content = view.contentDOM.getBoundingClientRect();
          const scroller = view.scrollDOM.getBoundingClientRect();
          const style = getComputedStyle(view.contentDOM);
          return {
            left: Math.max(0, Math.round(content.left - scroller.left + parseFloat(style.paddingLeft))),
            font: parseFloat(style.fontSize),
            row: view.defaultLineHeight,
          };
        },
        write: ({ left, font, row }, view) => {
          this.left = left;
          const s = view.dom.style;
          s.setProperty('--ln-width', `${left}px`);
          // Smaller than the text, on the height of the line's first row so the number sits beside it.
          s.setProperty('--ln-font', `${Math.round(font * 0.62 * 10) / 10}px`);
          s.setProperty('--ln-row', `${row}px`);
        },
      });
    }
    onMove = (e: MouseEvent) => {
      const over = e.clientX - this.view.scrollDOM.getBoundingClientRect().left < this.left;
      if (over === this.hover) return;
      this.hover = over;
      this.view.dom.classList.toggle('cm-ln-hover', over);
    };
    onLeave = () => {
      if (!this.hover) return;
      this.hover = false;
      this.view.dom.classList.remove('cm-ln-hover');
    };
    destroy() {
      this.view.scrollDOM.removeEventListener('mousemove', this.onMove);
      this.view.scrollDOM.removeEventListener('mouseleave', this.onLeave);
    }
  },
);

export const markdownLineNumbers = [lineNumbers(), placeNumbers];
