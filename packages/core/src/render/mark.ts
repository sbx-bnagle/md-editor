// ==Marked text==, shown highlighted (<mark>), as in iA Writer, Obsidian and Typora. Modelled on
// markdown-it's ~~strikethrough~~ rule (MIT): runs of two equals signs open and close, and
// markdown-it's pair matching (balance_pairs) decides which ones pair up.

import type MarkdownIt from 'markdown-it';
import type { Delimiter, StateInline } from 'markdown-it';

const EQUALS = 0x3d;

function tokenize(state: StateInline, silent: boolean): boolean {
  if (silent || state.src.charCodeAt(state.pos) !== EQUALS) return false;
  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;
  if (len % 2) {
    state.push('text', '', 0).content = '=';
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    state.push('text', '', 0).content = '==';
    state.delimiters.push({ marker: EQUALS, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close });
  }
  state.pos += scanned.length;
  return true;
}

function pairUp(state: StateInline, delimiters: Delimiter[]): void {
  for (const start of delimiters) {
    if (start.marker !== EQUALS || start.end === -1) continue;
    const end = delimiters[start.end];
    Object.assign(state.tokens[start.token], { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' });
    Object.assign(state.tokens[end.token], { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' });
  }
}

export function markedText(md: InstanceType<typeof MarkdownIt>): void {
  md.inline.ruler.before('emphasis', 'mde_mark', tokenize);
  md.inline.ruler2.before('emphasis', 'mde_mark', (state: StateInline) => {
    pairUp(state, state.delimiters);
    for (const meta of state.tokens_meta) if (meta?.delimiters) pairUp(state, meta.delimiters);
    return false;
  });
}
