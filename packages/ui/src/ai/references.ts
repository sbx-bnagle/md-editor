// Reference files of the open document's project, for the AI (Assistant, Ask AI, Review).

import { REFERENCES_DIR, paths } from '@mde/core';
import { api } from '../api/host';
import { reportError } from '../state/actions';
import { getState, setState, toast } from '../state/store';

export const REFERENCE_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'png', 'jpg', 'jpeg', 'gif', 'webp'];

export async function loadReferences(projectPath: string | null): Promise<void> {
  if (!projectPath) {
    setState({ references: { projectPath: null, items: [], loading: false } });
    return;
  }
  setState((s) => ({ references: { projectPath, items: s.references.projectPath === projectPath ? s.references.items : [], loading: true } }));
  try {
    const items = await api.references.list(projectPath);
    if (getState().references.projectPath === projectPath) setState({ references: { projectPath, items, loading: false } });
  } catch (e) {
    setState({ references: { projectPath, items: [], loading: false } });
    reportError(e);
  }
}

export async function setReferenceIncluded(path: string, included: boolean): Promise<void> {
  const projectPath = getState().references.projectPath ?? (await api.project.projectFor(path));
  if (!projectPath) return;
  try {
    await api.references.setIncluded(projectPath, path, included);
    await loadReferences(projectPath);
  } catch (e) {
    reportError(e);
  }
}

export async function addReferenceFiles(projectPath: string): Promise<void> {
  try {
    const files = await api.app.chooseFiles('Add reference files', REFERENCE_EXTENSIONS);
    if (!files.length) return;
    const added = await api.references.add(projectPath, files);
    await loadReferences(projectPath);
    toast(`Added ${added.length} file${added.length === 1 ? '' : 's'} to ${REFERENCES_DIR}.`, 'success');
  } catch (e) {
    reportError(e);
  }
}

/** The project whose included references go with AI requests, or undefined when there are none. */
export function aiReferences(): { projectPath: string } | undefined {
  const { doc, references } = getState();
  if (!doc?.projectPath || references.projectPath !== doc.projectPath) return undefined;
  return references.items.some((r) => r.included && !r.problem) ? { projectPath: doc.projectPath } : undefined;
}

export function includedReferenceCount(): number {
  return getState().references.items.filter((r) => r.included && !r.problem).length;
}

/** True when a changed path may change the reference list of `projectPath`. */
export function touchesReferences(changed: string[], projectPath: string, included: string[]): boolean {
  const dir = paths.join(projectPath, REFERENCES_DIR);
  return changed.some((p) => paths.isInside(p, dir) || included.includes(p) || p.endsWith('/.mdeditor/project.json'));
}
