// `+++` on a line of its own is a page break: <div class="page-break">, which BASE_CSS (and the
// bundled themes) break the page after. Like a rule (***), it can follow a line of text directly.
// Inside code it is text.

import type MarkdownIt from 'markdown-it';
import type { StateBlock } from 'markdown-it';

/** A page break line: three or more plus signs, indented less than four spaces. */
export const PAGE_BREAK_LINE = /^ {0,3}\+{3,}[ \t]*$/;

export function pageBreaks(md: InstanceType<typeof MarkdownIt>): void {
  md.block.ruler.before(
    'hr',
    'mde_page_break',
    (state: StateBlock, startLine: number, _endLine: number, silent: boolean) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
      if (!/^\+{3,}[ \t]*$/.test(line)) return false;
      if (silent) return true;
      const token = state.push('mde_page_break', 'div', 0);
      token.map = [startLine, startLine + 1];
      token.markup = line.trim();
      state.line = startLine + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );
  md.renderer.rules.mde_page_break = (tokens, idx, _options, _env, self) => `<div class="page-break"${self.renderAttrs(tokens[idx])}></div>\n`;
}
