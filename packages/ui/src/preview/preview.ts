// Runs inside the preview iframe. The parent posts a document; this page lays it out
// once (Paged.js is not re-entrant) and reports back. The parent swaps iframes per render.

import { renderPaged } from './render';
import { lineAtY, yForLine } from './sourceLines';

const container = document.getElementById('pages')!;

function post(msg: unknown) {
  window.parent.postMessage(msg, '*');
}

function applyZoom(zoom: number) {
  (container.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
}

function scrollToSourceLine(line: number, behavior: ScrollBehavior = 'auto') {
  const y = yForLine(container, line);
  if (y !== null) window.scrollTo({ top: y, behavior });
}

function reportScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  post({ type: 'scroll', ratio: max > 0 ? window.scrollY / max : 0, line: lineAtY(container) });
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('scroll', () => {
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    reportScroll();
  }, 100);
});

window.addEventListener('message', async (e) => {
  if (e.source !== window.parent) return;
  const msg = e.data as { type: string; [k: string]: unknown };
  if (msg.type === 'render') {
    applyZoom(Number(msg.zoom ?? 1));
    try {
      const { pages } = await renderPaged(container, { html: String(msg.html), css: String(msg.css), title: String(msg.title) });
      if (typeof msg.line === 'number') scrollToSourceLine(msg.line);
      else if (typeof msg.ratio === 'number') {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, max * msg.ratio);
      }
      post({ type: 'rendered', id: msg.id, pages });
      reportScroll();
    } catch (err) {
      post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === 'zoom') {
    const line = lineAtY(container);
    applyZoom(Number(msg.zoom));
    scrollToSourceLine(line);
  } else if (msg.type === 'scroll-to-line') {
    scrollToSourceLine(Number(msg.line), 'smooth');
  }
});

post({ type: 'ready' });
