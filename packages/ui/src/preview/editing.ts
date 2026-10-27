// Text editing in the preview (inside the preview iframe). Double-click a paragraph, heading, list
// item or table cell to edit its text; Enter or clicking elsewhere applies it, Escape cancels, and
// Shift+Enter in a heading adds a line break. The parent maps the change to the markdown source and
// re-renders; formatting is changed in the editor.

/** Cells of markdown tables (their rows carry the source line; HTML tables do not). */
const CELL = 'tr[data-src-line] > td, tr[data-src-line] > th';
const EDITABLE = [...['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].map((t) => `${t}[data-src-line]`), CELL].join(',');
const EXCLUDED = '.pagedjs_margin, .footnotes, .mde-pdf-insert, figure, .mde-vars, .mde-missing';
const BLOCK_CHILD = 'ul, ol, p, pre, blockquote, table, div, figure, section';

export interface PreviewEditingMessage {
  type: 'editing';
  active: boolean;
}

export interface PreviewEditMessage {
  type: 'edit';
  line: number;
  /** Column of an edited table cell (0-based); `line` is then its row's. */
  cell?: number;
  /** Project-relative path of the included file, or null for the document itself. */
  file: string | null;
  before: string;
  after: string;
}

function editableAt(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target.closest<HTMLElement>(EDITABLE) : null;
  if (!el || el.closest(EXCLUDED)) return null;
  // Paragraphs inside HTML tables are not markdown the preview can map.
  if (!el.matches(CELL) && el.closest('table')) return null;
  // A list item holding a nested list or paragraphs is edited through those, or in the editor.
  if (el.tagName === 'LI' && el.querySelector(BLOCK_CHILD)) return null;
  return el;
}

/** Line break character in the text sent to the parent (a <br> in the element). */
const BREAK = '\u2028';
/** Keeps a break typed at the very end visible until text follows it; not part of the text. */
const FILLER = '\u200b';

/** The element's text as the parent maps it: <br> as a line break character. */
function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').replaceAll(FILLER, '');
  if (node.nodeName === 'BR') return BREAK;
  let out = '';
  for (const child of node.childNodes) out += textOf(child);
  return out;
}

/** Puts a line break at the selection of the heading being edited. */
function insertBreak() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  // A break at the end of the element shows only with something after it.
  if (!br.nextSibling || (br.nextSibling.nodeType === Node.TEXT_NODE && !br.nextSibling.nodeValue)) br.after(document.createTextNode(FILLER));
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Source line, and column for a table cell. */
function placeOf(el: HTMLElement): { line: number; cell?: number } {
  if (!el.matches(CELL)) return { line: Number(el.dataset.srcLine) };
  const row = el.parentElement!;
  return { line: Number(row.dataset.srcLine), cell: [...row.children].indexOf(el) };
}

/** The pieces of an element Paged.js split across pages (they share data-ref). */
function piecesOf(container: HTMLElement, el: HTMLElement): HTMLElement[] {
  const ref = el.dataset.ref;
  // A cell is not split; a header row repeated on the next page is a copy with the same data-ref.
  if (!ref || el.matches(CELL)) return [el];
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
  const after = pieces.map(textOf).join('');
  if (!commit || after === before) el.innerHTML = html;
  else {
    el.classList.add('mde-edit-pending');
    pending = { el, html };
    post({ type: 'edit', ...placeOf(el), file: el.closest<HTMLElement>('.mde-include')?.dataset.srcFile ?? null, before, after });
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
    active = { el, pieces, html: el.innerHTML, before: pieces.map(textOf).join('') };
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
    if (e.key === 'Enter' && e.shiftKey && /^H[1-6]$/.test(active.el.tagName)) {
      e.preventDefault();
      insertBreak();
    } else if (e.key === 'Enter') {
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
