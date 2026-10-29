// Drag and drop in the library. Files and folders inside projects can be dragged onto a project or a
// folder (another one, or another project): they move, and ⌥ (Option) copies. Files and folders
// dropped from Finder move into the project (⌥ copies). Dragging an item out to Finder gives Finder a
// copy; the library keeps its own. When the name is taken where an item is dropped, the user chooses
// Replace, Keep Both or Stop.

import type { DragEvent } from 'react';
import { paths, type TransferResult } from '@mde/core';
import { api, droppedPaths, isIpad } from '../api/host';
import { closeTabsInside, followMove, loadProject, loadTree, openDialog, reportError, saveNow } from '../state/actions';
import { getState, setState, toast } from '../state/store';

/** The library item being dragged, when the drag started in the sidebar. */
let dragging: string | null = null;

/** A drag that ended outside the window (in Finder) leaves no drop or dragend event here. */
window.addEventListener('mousemove', (e) => {
  if (dragging && e.buttons === 0) dragging = null;
});
// A drag out of the app can pass over the editor: dropping it there must not insert the file's text.
window.addEventListener(
  'drop',
  (e) => {
    if (!dragging || (e.target instanceof Element && e.target.closest('[data-drop-dir]'))) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = null;
  },
  true,
);

/** Props for a row that can be dragged (a file or folder inside a project). */
export function dragSource(path: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragging = path;
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', paths.basename(path));
      if (isIpad) return;
      // On the Mac the drag carries a copy of the file, so it can be dropped in Finder; drops on
      // rows here use `dragging` (the original).
      e.preventDefault();
      api.ui.startDrag(path).catch(reportError);
    },
    onDragEnd: () => {
      dragging = null;
    },
  };
}

/** Whether the item being dragged (or files from Finder) can be dropped into `dir`. */
function accepts(e: DragEvent, dir: string): boolean {
  if (dragging) return !paths.isInside(dir, dragging) && (paths.dirname(dragging) !== dir || e.altKey);
  return e.dataTransfer.types.includes('Files');
}

/** Props for a row that takes drops (a project or a folder inside one); `setOver` shows the target. */
export function dropTarget(dir: string, setOver: (over: boolean) => void) {
  return {
    'data-drop-dir': dir,
    onDragEnter: (e: DragEvent) => {
      if (!accepts(e, dir)) return;
      e.preventDefault();
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!accepts(e, dir)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const sources = dragging ? [dragging] : droppedPaths(e.dataTransfer.files);
      dragging = null;
      if (!sources.length) {
        toast('These items cannot be added from here. Drag files or folders from Finder.');
        return;
      }
      void transferInto(sources, dir, e.altKey);
    },
  };
}

/** Asks what to do when `name` is already in `dir`: replace it, keep both, or stop (null). */
function askConflict(name: string, dir: string): Promise<'replace' | 'keep-both' | null> {
  return new Promise((resolve) => {
    openDialog({
      title: `“${name}” is already in “${paths.basename(dir)}”`,
      message: 'Replace it (the one there goes to the Trash), or keep both (the new one gets a number added to its name)?',
      fields: [],
      okLabel: 'Keep Both',
      onSubmit: async () => resolve('keep-both'),
      cancelLabel: 'Stop',
      onCancel: () => resolve(null),
      alt: { label: 'Replace', onClick: () => resolve('replace') },
    });
  });
}

/** Moves (or copies) items into a project folder, asking about names that are taken. */
export async function transferInto(sources: string[], dir: string, copy: boolean): Promise<void> {
  const touched = new Set<string>();
  const projectOf = async (p: string) => (await api.project.projectFor(p).catch(() => null)) ?? null;
  try {
    // The moved files carry the latest edits.
    await saveNow();
    for (const source of sources) {
      const from = await projectOf(source);
      let r: TransferResult = await api.files.transfer({ source, targetDir: dir, copy });
      if ('conflict' in r) {
        const choice = await askConflict(r.conflict, dir);
        if (!choice) break;
        // The item being replaced goes to the Trash: its tabs close first.
        if (choice === 'replace') await closeTabsInside(paths.join(dir, r.conflict));
        r = await api.files.transfer({ source, targetDir: dir, copy, conflict: choice });
      }
      if (!('path' in r)) continue;
      if (!copy && r.path !== source) await followMove(source, r.path);
      if (from) touched.add(from);
      const to = await projectOf(r.path);
      if (to) touched.add(to);
    }
  } catch (e) {
    reportError(e);
  }
  await loadTree();
  for (const p of touched) await loadProject(p);
  // Show where the items went.
  setState((s) => ({ expanded: { ...s.expanded, [dir]: true } }));
  if (getState().selected === null) setState({ selected: dir });
}
