// Page selections for inserted PDFs, written like "3, 1-2" (page 3, then pages 1 and 2).
// An empty selection means every page in order.

export interface PageSelection {
  pages: number[];
  error?: string;
}

/** Parses "3, 1-2", "5-", "4-2" (reversed) against a page count. */
export function parsePageSpec(spec: string | undefined, count: number): PageSelection {
  const all = Array.from({ length: count }, (_, i) => i + 1);
  const s = (spec ?? '').trim();
  if (!s || s.toLowerCase() === 'all') return { pages: all };
  const pages: number[] = [];
  for (const raw of s.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(part);
    if (!m) return { pages: all, error: `“${part}” is not a page number or range.` };
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : m[2] === '' ? count : Number(m[2]);
    if (from < 1 || to < 1 || from > count || to > count) return { pages: all, error: `Page ${Math.max(from, to)} is beyond the ${count} page${count === 1 ? '' : 's'} of the file.` };
    const step = from <= to ? 1 : -1;
    for (let p = from; p !== to + step; p += step) pages.push(p);
  }
  return pages.length ? { pages } : { pages: all };
}

/** Writes a page list compactly: [3, 1, 2] → "3,1-2"; every page in order → "". */
export function formatPageSpec(pages: number[], count: number): string {
  if (pages.length === count && pages.every((p, i) => p === i + 1)) return '';
  const parts: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j + 1;
  }
  return parts.join(',');
}

/** One inserted page: a placeholder page the export replaces with the PDF page. */
export interface PdfInsertPage {
  /** Project-relative path of the PDF. */
  file: string;
  /** 1-based page number in that file. */
  page: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Placeholder pages for an inserted PDF, one per selected page. Each sits alone on a page with
 * no margins or running headers (the mde-pdf named page in BASE_CSS); the preview draws the
 * PDF page into it and the export replaces it with the PDF page itself. role="img" with a
 * description makes each one a Figure in the PDF tags.
 */
export function pdfInsertHtml(opts: { file: string; src: string; pages: number[]; title: string | null; line?: number }): string {
  const name = opts.title || opts.file.split('/').pop() || opts.file;
  const line = opts.line !== undefined ? ` data-src-line="${opts.line}"` : '';
  const pages = opts.pages
    .map(
      (p, i) =>
        `<div class="mde-pdf-page" role="img" aria-label="${esc(`${name}, page ${i + 1} of ${opts.pages.length}`)}" data-pdf-file="${esc(opts.file)}" data-pdf-src="${esc(opts.src)}" data-pdf-page="${p}"></div>`,
    )
    .join('');
  return `<section class="mde-pdf-insert" data-pdf="${esc(opts.file)}"${line}>${pages}</section>\n`;
}
