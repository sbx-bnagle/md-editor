// Applying the changes the Assistant proposes (core aiEdits.ts). A change to a file that is not in
// the current tab opens it first (in a new tab), so every change goes through the editor: it is
// marked as AI-written, ⌘Z undoes it, and it is saved like typing.

import { aiAuthorKey, isMarkdownFile, locateEdit, pairStatus, paths, resolveEditPath, type EditPair, type PairStatus } from '@mde/core';
import { api } from '../api/host';
import { aiAuthor } from '../editor/authorship';
import { editorBridge } from '../editor/bridge';
import { kindFor, loadProject, openFile, reportError } from '../state/actions';
import { getState, toast } from '../state/store';

export type FileStatus = 'ready' | 'exists' | 'created' | 'outside' | 'missing-file';

/** Files created from the chat in this session (shown as “Created” rather than “exists”). */
const created = new Set<string>();
/** Deletions applied in this session: a deleted text cannot be found, but neither can one that never matched. */
const deletions = new Set<string>();
const deletionKey = (path: string, search: string) => `${path}\0${search}`;

/** The file's current text: the editor's when it is open in the current tab, otherwise from disk. Null when it does not exist. */
async function currentText(path: string): Promise<string | null> {
  const { doc } = getState();
  if (doc?.path === path && editorBridge.view) return editorBridge.view.state.doc.toString();
  try {
    return isMarkdownFile(path) ? (await api.files.readDocument(path)).text : await api.files.readText(path);
  } catch {
    return null;
  }
}

/** Status of each pair of an edit block, or of the file when the block cannot be used. */
export async function editStatus(root: string, file: string, pairs: EditPair[]): Promise<{ file?: FileStatus; pairs: PairStatus[] }> {
  const path = resolveEditPath(root, file);
  if (!path) return { file: 'outside', pairs: [] };
  const text = await currentText(path);
  if (text === null) return { file: 'missing-file', pairs: [] };
  return { pairs: pairs.map((p) => (!p.replace && deletions.has(deletionKey(path, p.search)) && pairStatus(text, p) === 'missing' ? 'applied' : pairStatus(text, p))) };
}

export async function createStatus(root: string, file: string): Promise<FileStatus> {
  const path = resolveEditPath(root, file);
  if (!path) return 'outside';
  if ((await currentText(path)) === null) return 'ready';
  return created.has(path) ? 'created' : 'exists';
}

/** Shows `path` in the current tab (opening it in a new tab unless it is there) and returns its editor. */
async function editorShowing(path: string) {
  if (getState().doc?.path !== path) await openFile(path, { newTab: true });
  const view = await editorBridge.editorFor(path);
  if (!view) toast(`“${paths.basename(path)}” could not be opened for editing.`, 'error');
  return view;
}

function log(docPath: string, model: string, prompt: string, text: string): void {
  if (getState().doc?.projectPath) api.ai.logInsertion({ docPath, time: Date.now(), model, mode: 'chat', prompt, text }).catch(() => undefined);
}

/**
 * Applies the given pairs of an edit block (all of them by default) that can be applied; the
 * others are left. Returns how many were applied.
 */
export async function applyEdit(root: string, file: string, pairs: EditPair[], opts: { model: string; prompt: string }): Promise<number> {
  const path = resolveEditPath(root, file);
  if (!path) return 0;
  try {
    const view = await editorShowing(path);
    if (!view) return 0;
    const record = getState().prefs?.recordAuthorship !== false;
    let applied = 0;
    let last: { from: number; to: number } | null = null;
    for (const pair of pairs) {
      // Each pair is found again in the text as it is after the previous ones.
      const at = locateEdit(view.state.doc.toString(), pair.search);
      if (!('from' in at)) continue;
      view.dispatch({
        changes: { from: at.from, to: at.to, insert: pair.replace },
        userEvent: 'input.ai',
        annotations: record && pair.replace ? aiAuthor.of(aiAuthorKey(opts.model)) : [],
      });
      last = { from: at.from, to: at.from + pair.replace.length };
      applied++;
      if (!pair.replace) deletions.add(deletionKey(path, pair.search));
      if (pair.replace) log(path, opts.model, opts.prompt, pair.replace);
    }
    if (last) view.dispatch({ selection: { anchor: last.from, head: last.to }, scrollIntoView: true });
    view.focus();
    return applied;
  } catch (e) {
    reportError(e);
    return 0;
  }
}

/** Creates a file proposed by the Assistant and opens it in a new tab, its text marked as AI-written. */
export async function createFile(root: string, file: string, content: string, opts: { model: string; prompt: string }): Promise<boolean> {
  const path = resolveEditPath(root, file);
  if (!path) return false;
  try {
    if ((await currentText(path)) !== null) {
      toast(`“${file}” already exists.`, 'error');
      return false;
    }
    const editable = ['markdown', 'css', 'text'].includes(kindFor(path));
    // A file the editor cannot open is written as proposed.
    await api.files.createFile(paths.dirname(path), paths.basename(path), editable ? '' : content);
    const project = await api.project.projectFor(path).catch(() => null);
    if (project) await loadProject(project);
    if (!editable) {
      created.add(path);
      toast(`Created “${paths.basename(path)}”.`, 'success');
      return true;
    }
    const view = await editorShowing(path);
    if (!view) return false;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: { anchor: 0 },
      userEvent: 'input.ai',
      annotations: getState().prefs?.recordAuthorship !== false ? aiAuthor.of(aiAuthorKey(opts.model)) : [],
      scrollIntoView: true,
    });
    log(path, opts.model, opts.prompt, content);
    created.add(path);
    view.focus();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}
