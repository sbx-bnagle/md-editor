/// <reference path="./modules.d.ts" />
// Text and page count of a PDF, with pdf.js (Mozilla, Apache-2.0). Loaded on first use.

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let loading: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    // The worker runs in this process ("fake worker"); importing it here lets the bundler include it.
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return loading;
}

export interface PdfText {
  pages: number;
  /** Text by page, in order. */
  pageTexts: string[];
}

export class PdfPasswordError extends Error {}

export async function pdfText(bytes: Uint8Array): Promise<PdfText> {
  const lib = await pdfjs();
  // pdf.js may transfer the buffer: give it a copy.
  const task = lib.getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    if (e && typeof e === 'object' && (e as { name?: string }).name === 'PasswordException') throw new PdfPasswordError('This PDF is password protected.');
    throw e;
  }
  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        text += item.hasEOL ? '\n' : item.str && !/\s$/.test(item.str) ? ' ' : '';
      }
      pageTexts.push(text.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim());
      page.cleanup();
    }
    return { pages: doc.numPages, pageTexts };
  } finally {
    await task.destroy();
  }
}
