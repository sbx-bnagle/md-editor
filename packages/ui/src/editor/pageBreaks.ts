// `+++` page breaks in the editor (core render/pageBreaks.ts renders them): a node styled like a
// rule, which can end a paragraph as the renderer's does.

import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

const LINE = /^\+{3,}[ \t]*$/;

export const PageBreak: MarkdownConfig = {
  defineNodes: [{ name: 'PageBreak', block: true, style: tags.contentSeparator }],
  parseBlock: [
    {
      name: 'PageBreak',
      parse(cx, line) {
        if (line.indent >= 4 || !LINE.test(line.text.slice(line.pos))) return false;
        cx.addElement(cx.elt('PageBreak', cx.lineStart + line.pos, cx.lineStart + line.text.length));
        cx.nextLine();
        return true;
      },
      endLeaf: (_cx, line) => line.indent < 4 && LINE.test(line.text.slice(line.pos)),
      before: 'HorizontalRule',
    },
  ],
};
