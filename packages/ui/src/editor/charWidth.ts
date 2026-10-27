// The editor font's character width, for layout measured in characters (list and heading indents).

import type { EditorView } from '@codemirror/view';

/**
 * The editor font's character width in em, from the editor's own measurement (CSS ch units are not
 * reliable with the bundled fonts). In em, an indent follows size and zoom changes at once.
 */
export function charEm(view: EditorView): number {
  const size = parseFloat(getComputedStyle(view.contentDOM).fontSize);
  return size > 0 ? view.defaultCharacterWidth / size : 0.6;
}
