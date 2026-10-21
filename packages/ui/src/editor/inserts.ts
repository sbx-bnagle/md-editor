// Right-click inserts in the editor: HTML entities, the system emoji picker, and small inline
// images sized to the text (a logo in a sentence).

import type { EditorView } from '@codemirror/view';
import { isImageFile, paths, type ContextMenuItem, type FileEntry } from '@mde/core';
import { api } from '../api/host';
import { reportError } from '../state/actions';
import { getState, toast } from '../state/store';

/** Entities that are hard to type or invisible (spaces, soft hyphen), with what they show. */
export const ENTITIES: Array<{ code: string; label: string }> = [
  { code: '&nbsp;', label: 'Non-breaking space' },
  { code: '&#8209;', label: 'Non-breaking hyphen ‑' },
  { code: '&shy;', label: 'Soft hyphen (break point)' },
  { code: '&thinsp;', label: 'Thin space' },
  { code: '&ensp;', label: 'En space' },
  { code: '&emsp;', label: 'Em space' },
  { code: '&copy;', label: '© Copyright' },
  { code: '&reg;', label: '® Registered' },
  { code: '&trade;', label: '™ Trademark' },
  { code: '&sect;', label: '§ Section' },
  { code: '&para;', label: '¶ Paragraph' },
  { code: '&dagger;', label: '† Dagger' },
  { code: '&Dagger;', label: '‡ Double dagger' },
  { code: '&bull;', label: '• Bullet' },
  { code: '&middot;', label: '· Middle dot' },
  { code: '&hellip;', label: '… Ellipsis' },
  { code: '&deg;', label: '° Degree' },
  { code: '&plusmn;', label: '± Plus or minus' },
  { code: '&times;', label: '× Multiplication' },
  { code: '&divide;', label: '÷ Division' },
  { code: '&minus;', label: '− Minus' },
  { code: '&frac12;', label: '½ One half' },
  { code: '&rarr;', label: '→ Right arrow' },
  { code: '&larr;', label: '← Left arrow' },
  { code: '&check;', label: '✓ Check mark' },
  { code: '&euro;', label: '€ Euro' },
  { code: '&pound;', label: '£ Pound' },
];

const INLINE_IMAGE_DIR = 'images';
const MAX_LISTED_IMAGES = 30;

export function insertAtCursor(view: EditorView, text: string): void {
  const sel = view.state.selection.main;
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, userEvent: 'input.insert' });
  view.focus();
}

/** Path to write in the document for `target`, relative to the document's folder. */
function relativeTo(docPath: string, target: string): string {
  return paths.relative(paths.dirname(docPath), target);
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * An image the height of the text around it. Its description defaults to the file name;
 * screen readers read it, so it should name what the image shows ("Acme logo").
 */
export function inlineImageHtml(docPath: string, imagePath: string): string {
  const alt = paths.basename(imagePath).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return `<img src="${escapeAttr(relativeTo(docPath, imagePath))}" alt="${escapeAttr(alt)}" class="mde-inline-image">`;
}

/** Images in the open document's project, for the Inline Image submenu (ids "img:<path>"). */
export async function projectImageItems(): Promise<ContextMenuItem[]> {
  const { doc } = getState();
  if (!doc?.projectPath) return [];
  const details = await api.project.details(doc.projectPath).catch(() => null);
  const found: string[] = [];
  const walk = (entries: FileEntry[]) => {
    for (const e of entries) {
      if (e.type === 'dir') walk(e.children ?? []);
      else if (isImageFile(e.path)) found.push(e.path);
    }
  };
  walk(details?.files ?? []);
  return found.slice(0, MAX_LISTED_IMAGES).map((p) => ({ id: `img:${p}`, label: paths.relative(doc.projectPath!, p) }));
}

/** Copies a chosen image into the project's images folder and inserts it. */
export async function chooseInlineImage(view: EditorView): Promise<void> {
  const { doc } = getState();
  if (doc?.kind !== 'markdown' || !doc.projectPath) {
    toast('Open a project document first.');
    return;
  }
  try {
    const files = await api.app.chooseFiles('Choose an image', ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
    if (!files.length) return;
    const inside = files[0].startsWith(`${doc.projectPath}/`);
    const target = inside ? files[0] : (await api.project.importFiles(doc.projectPath, [files[0]], INLINE_IMAGE_DIR))[0];
    insertAtCursor(view, inlineImageHtml(doc.path, target));
  } catch (e) {
    reportError(e);
  }
}
