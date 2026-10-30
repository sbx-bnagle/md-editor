// Images, fonts and PDFs that documents and themes use are served to the page (and the preview
// frame) by the service worker (sw.ts) at <app>/__asset/<path>; it asks this page for the file's
// contents, which come from the library or the app's own files.

import { promises as fs } from './shims/fs';

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  css: 'text/css',
  csv: 'text/csv',
  md: 'text/plain; charset=utf-8',
  mmd: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

export const assetPrefix = (): string => new URL('__asset', new URL('./', location.href)).href;

/** Starts the service worker and answers its requests for files. */
export async function serveAssets(allowed: () => string[]): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('This browser cannot show images and fonts from the library (no service workers).');
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; path?: string } | null;
    const port = e.ports[0];
    if (data?.type !== 'folio-asset' || !port || typeof data.path !== 'string') return;
    const path = data.path;
    void (async () => {
      try {
        if (!allowed().some((root) => path === root || path.startsWith(`${root}/`))) throw new Error('not allowed');
        const bytes = await fs.readFile(path);
        const ext = path.split('.').pop()?.toLowerCase() ?? '';
        port.postMessage({ ok: true, bytes, type: TYPES[ext] ?? 'application/octet-stream' });
      } catch {
        port.postMessage({ ok: false });
      }
    })();
  });
  await navigator.serviceWorker.register(new URL('sw.js', new URL('./', location.href)).href, { scope: './' });
  const reg = await navigator.serviceWorker.ready;
  // Until the page is controlled (first visit), its own image requests do not reach the worker.
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      reg.active?.postMessage({ type: 'folio-claim' });
      setTimeout(resolve, 3000);
    });
  }
  navigator.serviceWorker.controller?.postMessage({ type: 'folio-host' });
}
