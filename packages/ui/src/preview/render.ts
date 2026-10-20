// Shared by the on-screen preview (preview.html) and PDF printing (print.html):
// lays out composed HTML into pages with Paged.js (CSS Paged Media polyfill).

import { Previewer } from 'pagedjs-esm';

export interface PagedInput {
  html: string;
  css: string;
  title: string;
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

/** Renders into `container`; returns the page count. Call once per document load. */
export async function renderPaged(container: HTMLElement, input: PagedInput): Promise<number> {
  document.title = input.title;
  const tpl = document.createElement('template');
  tpl.innerHTML = input.html;
  await preloadImages(tpl.content);
  const flow = await new Previewer().preview(tpl.content, [{ 'document.css': input.css }], container);
  await document.fonts.ready;
  return flow.total;
}
