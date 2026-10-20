// Highlights content block lines (transclusions), {{variables}}, and the front matter block.

import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { frontMatterRange, parseContentBlock } from '@mde/core';

const blockLine = Decoration.line({ class: 'cm-content-block' });
const blockMissingTitle = Decoration.mark({ class: 'cm-content-block-path' });
const frontMatterLine = Decoration.line({ class: 'cm-front-matter' });
const variable = Decoration.mark({ class: 'cm-variable' });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const fm = frontMatterRange(doc.sliceString(0, Math.min(doc.length, 20000)));
  let fence: string | null = null;
  // Fences must be tracked from the top so content blocks inside code are not styled.
  const lastVisible = view.visibleRanges.length ? doc.lineAt(view.visibleRanges[view.visibleRanges.length - 1].to).number : 0;
  const firstVisible = view.visibleRanges.length ? doc.lineAt(view.visibleRanges[0].from).number : 1;
  for (let n = 1; n <= lastVisible; n++) {
    const line = doc.line(n);
    const text = line.text;
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    if (n < firstVisible) continue;
    if (fm && line.from < fm[1]) {
      builder.add(line.from, line.from, frontMatterLine);
      continue;
    }
    if ((text[0] === '/' || text[0] === '.' || text[0] === 'h' || text[0] === ' ' || text[0] === '<') && parseContentBlock(text)) {
      builder.add(line.from, line.from, blockLine);
      builder.add(line.from, line.to, blockMissingTitle);
      continue;
    }
    if (text.includes('{{')) {
      const re = /\\?\{\{[^{}\n]+?\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) if (m[0][0] !== '\\') builder.add(line.from + m.index, line.from + m.index + m[0].length, variable);
    }
  }
  return builder.finish();
}

export const syntaxDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
