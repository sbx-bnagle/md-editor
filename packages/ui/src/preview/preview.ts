// Runs inside the preview iframe. The parent posts a document; this page lays it out
// once (Paged.js is not re-entrant) and reports back. The parent swaps iframes per render.

import { renderPaged } from './render';

const container = document.getElementById('pages')!;

function post(msg: unknown) {
  window.parent.postMessage(msg, '*');
}

function applyZoom(zoom: number) {
  (container.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
}

function scrollToSourceLine(line: number, behavior: ScrollBehavior = 'auto') {
  let best: Element | null = null;
  let bestLine = -1;
  for (const el of container.querySelectorAll('[data-src-line]')) {
    if (el.closest('.mde-include') || el.closest('.pagedjs_margin')) continue;
    const l = Number(el.getAttribute('data-src-line'));
    if (l <= line && l >= bestLine) {
      best = el;
      bestLine = l;
    }
  }
  if (best) best.scrollIntoView({ block: 'start', behavior });
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('scroll', () => {
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    post({ type: 'scroll', ratio: max > 0 ? window.scrollY / max : 0 });
  }, 100);
});

window.addEventListener('message', async (e) => {
  if (e.source !== window.parent) return;
  const msg = e.data as { type: string; [k: string]: unknown };
  if (msg.type === 'render') {
    applyZoom(Number(msg.zoom ?? 1));
    try {
      const pages = await renderPaged(container, { html: String(msg.html), css: String(msg.css), title: String(msg.title) });
      if (typeof msg.line === 'number') scrollToSourceLine(msg.line);
      else if (typeof msg.ratio === 'number') {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, max * msg.ratio);
      }
      post({ type: 'rendered', id: msg.id, pages });
    } catch (err) {
      post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === 'zoom') {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? window.scrollY / max : 0;
    applyZoom(Number(msg.zoom));
    window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * ratio);
  } else if (msg.type === 'scroll-to-line') {
    scrollToSourceLine(Number(msg.line), 'smooth');
  }
});

window.addEventListener('keydown', (e) => {
  // Forward app shortcuts (e.g. Cmd+R) that the iframe would otherwise swallow.
  if (e.metaKey || e.ctrlKey) post({ type: 'key', key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
});

post({ type: 'ready' });
