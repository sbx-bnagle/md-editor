// Text editing in the preview (inside the preview iframe). Double-click a paragraph, heading or
// list item to edit its text; Enter or clicking elsewhere applies it, Escape cancels. The parent
// maps the change to the markdown source and re-renders; formatting is changed in the editor.

const EDITABLE = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].map((t) => `${t}[data-src-line]`).join(',');
const EXCLUDED = '.pagedjs_margin, .footnotes, .mde-pdf-insert, figure, table, .mde-vars, .mde-missing';
const BLOCK_CHILD = 'ul, ol, p, pre, blockquote, table, div, figure, section';

export interface PreviewEditingMessage {
  type: 'editing';
  active: boolean;
}

export interface PreviewEditMessage {
  type: 'edit';
  line: number;
  /** Project-relative path of the included file, or null for the document itself. */
  file: string | null;
  before: string;
  after: string;
}

function editableAt(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target.closest<HTMLElement>(EDITABLE) : null;
  if (!el || el.closest(EXCLUDED)) return null;
  // A list item holding a nested list or paragraphs is edited through those, or in the editor.
  if (el.tagName === 'LI' && el.querySelector(BLOCK_CHILD)) return null;
  return el;
}

/** The pieces of an element Paged.js split across pages (they share data-ref). */
function piecesOf(container: HTMLElement, el: HTMLElement): HTMLElement[] {
  const ref = el.dataset.ref;
  if (!ref) return [el];
  return [...container.querySelectorAll<HTMLElement>(`[data-ref="${CSS.escape(ref)}"]`)].filter((p) => p.tagName === el.tagName);
}

let active: { el: HTMLElement; pieces: HTMLElement[]; html: string; before: string } | null = null;
let pending: { el: HTMLElement; html: string } | null = null;

type Post = (m: PreviewEditMessage | PreviewEditingMessage) => void;

function finish(commit: boolean, post: Post) {
  if (!active) return;
  const { el, pieces, html, before } = active;
  active = null;
  el.removeAttribute('contenteditable');
  el.classList.remove('mde-editing');
  const after = pieces.map((p) => p.textContent ?? '').join('');
  if (!commit || after === before) el.innerHTML = html;
  else {
    el.classList.add('mde-edit-pending');
    pending = { el, html };
    post({ type: 'edit', line: Number(el.dataset.srcLine), file: el.closest<HTMLElement>('.mde-include')?.dataset.srcFile ?? null, before, after });
  }
  // After the edit message, so the parent drops frames laid out before the edit.
  post({ type: 'editing', active: false });
}

/** Puts back the text of an edit the parent could not apply. */
export function revertPendingEdit() {
  if (!pending) return;
  pending.el.innerHTML = pending.html;
  pending.el.classList.remove('mde-edit-pending');
  pending = null;
}

export function enableEditing(container: HTMLElement, post: Post) {
  container.addEventListener('dblclick', (e) => {
    const el = editableAt(e.target);
    if (!el || active?.el === el || pending) return;
    finish(true, post);
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const pieces = piecesOf(container, el);
    active = { el, pieces, html: el.innerHTML, before: pieces.map((p) => p.textContent ?? '').join('') };
    post({ type: 'editing', active: true });
    el.setAttribute('contenteditable', 'plaintext-only');
    el.classList.add('mde-editing');
    el.focus();
    // Keep the word the double-click selected.
    if (range && selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
  container.addEventListener('keydown', (e) => {
    if (!active || e.target !== active.el) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true, post);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false, post);
    }
  });
  container.addEventListener('focusout', (e) => {
    if (active && e.target === active.el) finish(true, post);
  });
}
