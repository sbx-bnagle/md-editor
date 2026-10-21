// Draws pages of PDFs with pdf.js (Mozilla, Apache-2.0): inserted pages in the preview, and
// thumbnails in the page picker.

import type { PDFDocumentProxy } from 'pdfjs-dist';

let lib: Promise<typeof import('pdfjs-dist')> | null = null;

function pdfjs(): Promise<typeof import('pdfjs-dist')> {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })();
  return lib;
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();

/** Opens a PDF by URL (cached for the life of the page). */
export function openPdf(url: string): Promise<PDFDocumentProxy> {
  let d = docs.get(url);
  if (!d) {
    d = pdfjs().then(async (m) => {
      const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return m.getDocument({ data, disableFontFace: false }).promise;
    });
    docs.set(url, d);
    d.catch(() => docs.delete(url));
  }
  return d;
}

/** Renders page `n` (1-based) to an image URL, `width` CSS pixels wide (a data URL when asked, for files that leave the app). */
export async function renderPageImage(url: string, n: number, width: number, dataUrl = false): Promise<string> {
  const doc = await openPdf(url);
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = (width * Math.min(2, window.devicePixelRatio || 1)) / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  if (dataUrl) return canvas.toDataURL('image/png');
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
}

/**
 * Fills inserted-page placeholders with images of the pages (preview only; the export puts the
 * real pages in their place). Failures leave the placeholder with a note.
 */
export async function renderInsertedPages(root: DocumentFragment, width: number, dataUrl = false): Promise<void> {
  const placeholders = [...root.querySelectorAll<HTMLElement>('.mde-pdf-page')];
  await Promise.all(
    placeholders.map(async (el) => {
      try {
        const src = await renderPageImage(el.dataset.pdfSrc ?? '', Number(el.dataset.pdfPage), width, dataUrl);
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        // Decode before moving it into the template: images in a template's inert document
        // never load, so decode() there would not settle.
        await img.decode().catch(() => undefined);
        el.append(img);
      } catch (e) {
        el.textContent = `Could not draw this page: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  );
}
