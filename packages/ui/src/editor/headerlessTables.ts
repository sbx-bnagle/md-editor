// The editor's side of tables that start with a separator row (core render/headerlessTables.ts
// renders them). Builds the same nodes as the GFM table extension (Table, TableDelimiter,
// TableRow, TableCell), so highlighting and sideways scrolling (tables.ts) apply to them too.

import type { BlockContext, Element, LeafBlock, LeafBlockParser, Line, MarkdownConfig } from '@lezer/markdown';
import { TABLE_DELIMITER_ROW } from '@mde/core';

/** Cells and pipes of a row, as the GFM extension parses them (@lezer/markdown, MIT). */
function parseRow(cx: BlockContext, line: string, startI: number, elts: Element[], offset: number): void {
  let cellStart = -1;
  let cellEnd = -1;
  let esc = false;
  const cell = () => elts.push(cx.elt('TableCell', offset + cellStart, offset + cellEnd, cx.parser.parseInline(line.slice(cellStart, cellEnd), offset + cellStart)));
  for (let i = startI; i < line.length; i++) {
    const next = line.charCodeAt(i);
    if (next === 124 /* | */ && !esc) {
      if (cellStart > -1) cell();
      elts.push(cx.elt('TableDelimiter', i + offset, i + offset + 1));
      cellStart = cellEnd = -1;
    } else if (esc || (next !== 32 && next !== 9)) {
      if (cellStart < 0) cellStart = i;
      cellEnd = i + 1;
    }
    esc = !esc && next === 92;
  }
  if (cellStart > -1) cell();
}

class HeaderlessTableParser implements LeafBlockParser {
  private rows: Element[] = [];

  nextLine(cx: BlockContext, line: Line): boolean {
    const content: Element[] = [];
    parseRow(cx, line.text, line.pos, content, cx.lineStart);
    this.rows.push(cx.elt('TableRow', cx.lineStart + line.pos, cx.lineStart + line.text.length, content));
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    if (!this.rows.length) return false;
    const firstLine = leaf.content.indexOf('\n');
    const delimiter = cx.elt('TableDelimiter', leaf.start, leaf.start + (firstLine < 0 ? leaf.content.length : firstLine));
    cx.addLeafElement(leaf, cx.elt('Table', leaf.start, leaf.start + leaf.content.length, [delimiter, ...this.rows]));
    return true;
  }
}

export const HeaderlessTable: MarkdownConfig = {
  parseBlock: [
    {
      name: 'HeaderlessTable',
      leaf: (_cx, leaf) => (TABLE_DELIMITER_ROW.test(leaf.content.trim()) ? new HeaderlessTableParser() : null),
      before: 'SetextHeading',
    },
  ],
};
