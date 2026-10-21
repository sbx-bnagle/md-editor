// Shared by the on-screen preview (preview.html) and PDF printing (print.html):
// lays out composed HTML into pages with Paged.js (CSS Paged Media polyfill).

import { Handler, Previewer, registerHandlers } from 'pagedjs-esm';
import { pageContentWidth, type PdfInsertPage } from '@mde/core';
import { renderDiagrams } from './diagrams';
import { renderInsertedPages } from './pdfPages';

/**
 * Paged.js 0.4.3 honors break-inside: avoid only for elements that start below the page end,
 * so a diagram that starts on a page and runs past it is cut through its SVG. Elements marked
 * data-break-inside="avoid" (diagrams) move to the next page whole instead, unless they already
 * start at the top of the page (taller than a page: splitting is the only option).
 */
class KeepTogether extends Handler {
  onOverflow(overflow: Range | undefined, rendered: Element, bounds: DOMRect): Range | undefined {
    if (!overflow) return undefined;
    const start = overflow.startContainer;
    const el = (start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement)?.closest('[data-break-inside="avoid"]');
    if (!el || !rendered.contains(el) || el.getBoundingClientRect().top - bounds.top < 2) return undefined;
    const range = document.createRange();
    range.setStartBefore(el);
    range.setEndAfter(rendered.lastChild!);
    return range;
  }
}
registerHandlers(KeepTogether);

export interface PagedInput {
  html: string;
  css: string;
  title: string;
  /** BCP 47 language of the document (front matter `lang`); Chromium writes it to the PDF. */
  lang?: string;
  /** Printing to PDF: inserted pages stay blank (the export puts the real pages there). */
  print?: boolean;
}

export interface PagedResult {
  pages: number;
  /** Where inserted PDF pages landed: 0-based page index. */
  inserts: Array<PdfInsertPage & { index: number; alt: string }>;
}

function preloadImages(root: DocumentFragment, timeoutMs = 8000): Promise<void> {
  const urls = [...root.querySelectorAll('img')].map((img) => img.getAttribute('src')).filter((s): s is string => !!s);
  const loads = urls.map(
    (src) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = src;
      }),
  );
  return Promise.race([Promise.all(loads).then(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

/** Renders into `container`; returns the page count and inserted pages. Call once per document load. */
export async function renderPaged(container: HTMLElement, input: PagedInput): Promise<PagedResult> {
  document.title = input.title;
  if (input.lang) document.documentElement.lang = input.lang;
  const tpl = document.createElement('template');
  tpl.innerHTML = input.html;
  await preloadImages(tpl.content);
  await renderDiagrams(tpl.content, input.css);
  if (!input.print) await renderInsertedPages(tpl.content, pageContentWidth(input.css) + 192);
  const flow = await new Previewer().preview(tpl.content, [{ 'document.css': input.css }], container);
  await document.fonts.ready;
  const inserts: PagedResult['inserts'] = [];
  container.querySelectorAll('.pagedjs_page').forEach((page, index) => {
    const ph = page.querySelector<HTMLElement>('.mde-pdf-page');
    if (ph) inserts.push({ index, file: ph.dataset.pdfFile ?? '', page: Number(ph.dataset.pdfPage), alt: ph.getAttribute('aria-label') ?? '' });
  });
  return { pages: flow.total, inserts };
}

/**
 * For the single-page web export: draws diagrams and inserted PDF pages (as data URLs) without
 * laying out pages, and returns the HTML.
 */
export async function renderWeb(input: { html: string; css: string; title: string; lang?: string }): Promise<string> {
  document.title = input.title;
  if (input.lang) document.documentElement.lang = input.lang;
  const tpl = document.createElement('template');
  tpl.innerHTML = input.html;
  await renderDiagrams(tpl.content, input.css);
  await renderInsertedPages(tpl.content, pageContentWidth(input.css) + 192, true);
  return tpl.innerHTML;
}
