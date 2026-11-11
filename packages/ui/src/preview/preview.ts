// Runs inside the preview iframe. The parent posts a document; this page lays it out
// once (Paged.js is not re-entrant) and reports back. The parent swaps iframes per render.

import { renderPaged } from './render';
import { enableEditing, revertPendingEdit } from './editing';
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

/** 1-based number of the page that fills the top third of the window. */
function currentPage(): number {
  const pages = container.querySelectorAll('.pagedjs_page');
  const y = window.innerHeight / 3;
  for (let i = 0; i < pages.length; i++) if (pages[i].getBoundingClientRect().bottom > y) return i + 1;
  return Math.max(1, pages.length);
}

function reportScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  post({ type: 'scroll', ratio: max > 0 ? window.scrollY / max : 0, line: lineAtY(container), page: currentPage() });
}

enableEditing(container, post);

// Theme editing: a double-click shows the CSS rules that style an element (the app lists them in a
// flyout) instead of editing its text. The element is outlined while its rules are shown.
let inspecting = false;
const INSPECTED = 'data-mde-inspect';
const outline = document.createElement('style');
outline.textContent = `[${INSPECTED}] { outline: 2px solid #6ea8fe !important; outline-offset: 1px !important; }`;
document.head.append(outline);
const clearInspected = () => document.querySelectorAll(`[${INSPECTED}]`).forEach((el) => el.removeAttribute(INSPECTED));
container.addEventListener(
  'dblclick',
  (e) => {
    if (!inspecting) return;
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    const target = e.target instanceof Element ? e.target : e.target instanceof Node ? e.target.parentElement : null;
    if (!target || !target.closest('.pagedjs_page')) return;
    clearInspected();
    target.setAttribute(INSPECTED, '');
    post({ type: 'inspect', x: e.clientX, y: e.clientY });
  },
  true,
);
container.addEventListener('click', (e) => {
  // A single click elsewhere closes the flyout (the first click of a double-click too; the double-click opens it again).
  if (inspecting && e.detail === 1) post({ type: 'inspect-close' });
});
window.addEventListener('keydown', (e) => {
  if (inspecting && e.key === 'Escape') post({ type: 'inspect-close' });
});

// Links: #anchors scroll within the document; web links open in the browser with ⌘-click
// (a plain click would interrupt proofreading).
container.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') ?? '';
  if (href.startsWith('#')) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
  else if ((e.metaKey || e.ctrlKey) && /^https?:/i.test(href)) post({ type: 'open-link', url: href });
});

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
    inspecting = msg.inspect === true;
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
  } else if (msg.type === 'scroll-to-page') {
    container.querySelectorAll('.pagedjs_page')[Number(msg.page) - 1]?.scrollIntoView({ block: 'start' });
  } else if (msg.type === 'inspect-clear') {
    clearInspected();
  } else if (msg.type === 'edit-failed') {
    revertPendingEdit();
  } else if (msg.type === 'scroll-to-line') {
    scrollToSourceLine(Number(msg.line), 'smooth');
  }
});

post({ type: 'ready' });
