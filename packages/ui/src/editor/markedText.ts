// ==Marked text== in the editor (core render/mark.ts renders it). Parsed like GFM strikethrough
// in @lezer/markdown (MIT): two equals signs, flanking rules as for ~~.

import { Tag, tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

/** Highlight tag for marked text (styled in setup.ts). */
export const markedTag = Tag.define();

const PUNCTUATION = /[\p{P}\p{S}]/u;
const MarkedDelim = { resolve: 'Marked', mark: 'MarkedMark' };

export const MarkedText: MarkdownConfig = {
  defineNodes: [
    { name: 'Marked', style: { 'Marked/...': markedTag } },
    { name: 'MarkedMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Marked',
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = PUNCTUATION.test(before);
        const pAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(MarkedDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter));
      },
      after: 'Emphasis',
    },
  ],
};
