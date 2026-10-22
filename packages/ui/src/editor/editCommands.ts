// Find and replace, and selecting occurrences: run from the Edit menu and from the same keys in
// the editor. A key press can reach both the editor and the menu; a run from one source right
// after a run of the same command from the other is the same key press, and is skipped.

import { Prec } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { openSearchPanel, replaceAll, searchPanelOpen, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';

export type EditCommand = 'find-replace' | 'replace-all' | 'select-all-occurrences' | 'select-next-occurrence';

const COMMANDS: Record<EditCommand, (view: EditorView) => boolean> = {
  'find-replace': openSearchPanel,
  // Replaces every match of the Find field with the Replace field; opens the panel when it is closed.
  'replace-all': (view) => (searchPanelOpen(view.state) ? replaceAll(view) : openSearchPanel(view)),
  'select-all-occurrences': selectSelectionMatches,
  'select-next-occurrence': selectNextOccurrence,
};

const SAME_PRESS_MS = 150;
const lastRun = new Map<EditCommand, { source: 'key' | 'menu'; at: number }>();

export function runEditCommand(view: EditorView, command: EditCommand, source: 'key' | 'menu'): boolean {
  const last = lastRun.get(command);
  const now = performance.now();
  if (last && last.source !== source && now - last.at < SAME_PRESS_MS) return true;
  lastRun.set(command, { source, at: now });
  return COMMANDS[command](view);
}

const bind = (key: string, command: EditCommand, scope?: string) => ({ key, scope, preventDefault: true, run: (v: EditorView) => runEditCommand(v, command, 'key') });

/** Ahead of CodeMirror's search keymap, which binds the same keys (except Replace All). */
export const editCommandKeymap = Prec.high(
  keymap.of([bind('Mod-f', 'find-replace', 'editor search-panel'), bind('Mod-Alt-Enter', 'replace-all', 'editor search-panel'), bind('Mod-Shift-l', 'select-all-occurrences'), bind('Mod-d', 'select-next-occurrence')]),
);
