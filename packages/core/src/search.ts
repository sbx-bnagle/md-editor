// Library search: matching names and file text against the words typed in the sidebar's search
// field. Case, accents and quote styles are ignored ("cafe" finds “Café”).

/** Folds case, accents and curly quotes so they do not affect matching. */
export function foldForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

/** The words of a query, folded. */
export function searchTerms(query: string): string[] {
  return foldForSearch(query).split(/\s+/).filter(Boolean);
}

/** True when every term occurs in `text`. */
export function matchesAll(text: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const t = foldForSearch(text);
  return terms.every((term) => t.includes(term));
}

export interface LineMatch {
  /** 0-based line number. */
  line: number;
  /** The line, trimmed and shortened around the first match. */
  text: string;
}

/**
 * Lines of `text` that contain any of the terms, when the whole text contains all of them.
 * Returns null when the text does not match.
 */
/**
 * Position in `line` of the character at `at` in its folded form. Folding can change the length
 * (accents are taken off; Korean syllables come apart into letters).
 */
function originalOffset(line: string, at: number): number {
  let folded = 0;
  let i = 0;
  for (const ch of line) {
    if (folded >= at) return i;
    folded += foldForSearch(ch).length;
    i += ch.length;
  }
  return i;
}

export function matchingLines(text: string, terms: string[], max = 3, width = 90): LineMatch[] | null {
  if (!matchesAll(text, terms)) return null;
  // Lines with more of the words come first; the chosen ones are listed in document order.
  const found: Array<{ line: number; score: number; at: number }> = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const folded = foldForSearch(lines[i]);
    const positions = terms.map((t) => folded.indexOf(t)).filter((n) => n >= 0);
    if (positions.length) found.push({ line: i, score: positions.length, at: Math.min(...positions) });
  }
  found.sort((a, b) => b.score - a.score || a.line - b.line);
  return found
    .slice(0, max)
    .sort((a, b) => a.line - b.line)
    .map(({ line, at: foldedAt }) => {
      const raw = lines[line].trim();
      const lead = lines[line].length - lines[line].trimStart().length;
      const at = originalOffset(lines[line], foldedAt);
      const start = Math.max(0, at - lead - Math.floor(width / 3));
      const slice = raw.slice(start, start + width);
      return { line, text: `${start > 0 ? '…' : ''}${slice}${start + width < raw.length ? '…' : ''}` };
    });
}
