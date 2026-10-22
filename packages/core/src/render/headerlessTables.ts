// Tables without a header row: a block that starts with a separator row (|:--|:--|) and has at
// least one row under it. Standard markdown needs a header row above the separator; this is an
// extension of the app's (GitHub and other editors show such a block as text). The table has a
// body only, no header cells. A separator row does not interrupt a paragraph, so text followed by
// a separator row keeps its standard meaning.

import type MarkdownIt from 'markdown-it';
import type { StateBlock } from 'markdown-it';

/** A separator row: cells of hyphens with optional colons for alignment, and at least one |. */
export const TABLE_DELIMITER_ROW = /^\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/;

/** Alignment of each column of a separator row ('' for none). */
export function delimiterAligns(row: string): Array<'left' | 'right' | 'center' | ''> {
  const cells = row.trim().split('|');
  if (cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => {
    const t = c.trim();
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
  });
}

/** Splits a row at unescaped pipes (as markdown-it does for tables), dropping the outer empty cells. */
function splitRow(row: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\' && row[i + 1] === '|') {
      current += '|';
      i++;
    } else if (c === '|') {
      out.push(current);
      current = '';
    } else current += c;
  }
  out.push(current);
  if (out.length && out[0].trim() === '') out.shift();
  if (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

export function headerlessTables(md: InstanceType<typeof MarkdownIt>): void {
  md.block.ruler.before('table', 'mde_headerless_table', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    if (state.sCount[startLine] - state.blkIndent >= 4 || startLine + 1 >= endLine) return false;
    const line = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
    const first = line(startLine).trim();
    if (!TABLE_DELIMITER_ROW.test(first)) return false;
    // At least one row, directly under the separator (not the start of another block).
    const second = startLine + 1;
    const terminators = state.md.block.ruler.getRules('blockquote');
    if (state.sCount[second] < state.blkIndent || state.sCount[second] - state.blkIndent >= 4 || !line(second).trim()) return false;
    if (terminators.some((rule) => rule(state, second, endLine, true))) return false;
    if (silent) return true;

    const aligns = delimiterAligns(first);
    const oldParent = state.parentType;
    state.parentType = 'table' as typeof state.parentType;
    const open = state.push('table_open', 'table', 1);
    const tableLines: [number, number] = [startLine, 0];
    open.map = tableLines;
    const body = state.push('tbody_open', 'tbody', 1);
    const bodyLines: [number, number] = [second, 0];
    body.map = bodyLines;
    let next = second;
    for (; next < endLine; next++) {
      if (state.sCount[next] < state.blkIndent) break;
      if (terminators.some((rule) => rule(state, next, endLine, true))) break;
      const text = line(next).trim();
      if (!text || state.sCount[next] - state.blkIndent >= 4) break;
      const cells = splitRow(text);
      const tr = state.push('tr_open', 'tr', 1);
      tr.map = [next, next + 1];
      for (let i = 0; i < aligns.length; i++) {
        const td = state.push('td_open', 'td', 1);
        if (aligns[i]) td.attrs = [['style', `text-align:${aligns[i]}`]];
        const inline = state.push('inline', '', 0);
        inline.content = (cells[i] ?? '').trim();
        inline.children = [];
        state.push('td_close', 'td', -1);
      }
      state.push('tr_close', 'tr', -1);
    }
    bodyLines[1] = next;
    state.push('tbody_close', 'tbody', -1);
    state.push('table_close', 'table', -1);
    tableLines[1] = next;
    state.parentType = oldParent;
    state.line = next;
    return true;
  });
}
