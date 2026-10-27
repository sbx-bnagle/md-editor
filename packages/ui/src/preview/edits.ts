// Applies text edits made in the preview to the markdown source: through the editor for the open
// document (so undo and authorship work as for typing), or to the included file on disk.

import { blockToSpans, humanAuthorKey, mapPreviewEdit, paths, spansAfterEdit } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { requestRender } from '../state/actions';
import { getState } from '../state/store';
import type { PreviewEditMessage } from './editing';

/** Returns an error message, or null when the edit was applied (or changed nothing). */
export async function applyPreviewEdit(msg: PreviewEditMessage): Promise<string | null> {
  const { doc, render, prefs } = getState();
  if (doc?.kind !== 'markdown') return 'Text can be edited in the preview of a markdown document.';
  const vars = render?.variables ?? {};
  const edit = { line: msg.line, cell: msg.cell, before: msg.before, after: msg.after };
  try {
    if (!msg.file) {
      const view = editorBridge.view;
      if (!view) return 'The document is not open in the editor.';
      const r = mapPreviewEdit(view.state.doc.toString(), edit, vars);
      if (r && 'error' in r) return r.error;
      if (r) view.dispatch({ changes: { from: r.from, to: r.to, insert: r.insert }, userEvent: 'input.preview' });
      requestRender();
      return null;
    }
    if (!doc.projectPath) return 'Included files can be edited in the preview of a project document.';
    const path = paths.join(doc.projectPath, msg.file);
    const file = await api.files.readDocument(path);
    if (file.annotationStatus === 'invalid') return `The authorship record of “${msg.file}” does not match its text. Make this change in the file itself.`;
    const r = mapPreviewEdit(file.text, edit, vars);
    if (r && 'error' in r) return r.error;
    if (r) {
      const spans = file.annotations ? blockToSpans(file.text, file.annotations) : [];
      const author = prefs?.recordAuthorship ? humanAuthorKey(prefs.authorName) : null;
      await api.files.saveDocument({
        path,
        text: file.text.slice(0, r.from) + r.insert + file.text.slice(r.to),
        spans: spansAfterEdit(spans, r.from, r.to, r.insert.length, author),
        annotations: file.annotations,
      });
      await api.history.touched(doc.projectPath);
    }
    requestRender();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
