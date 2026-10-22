// The project's markdown files, attached to Assistant requests so it can read them and propose
// changes to any of them (core aiEdits.ts). The open document is sent in the prompt instead, with
// its unsaved text. Reference files (the References folder, and other files marked as references)
// are left out: they are attached, or not, by their own checkboxes (references.ts). Files past
// PROJECT_FILES_CHARS are named in the system note but not sent.

import { relative, sep } from 'node:path';
import { PROJECT_FILES_CHARS, REFERENCES_DIR, type AiAttachment } from '@mde/core';
import type { DocumentService } from '../documents';
import type { LibraryService } from '../library';

export interface ProjectFiles {
  attachments: AiAttachment[];
  included: string[];
  omitted: string[];
}

export async function projectFileAttachments(library: LibraryService, documents: DocumentService, projectPath: string, exclude?: string): Promise<ProjectFiles> {
  const references = new Set((await library.readMeta(projectPath)).references ?? []);
  const out: ProjectFiles = { attachments: [], included: [], omitted: [] };
  let budget = PROJECT_FILES_CHARS;
  for (const path of await documents.documents(projectPath)) {
    const rel = relative(projectPath, path).split(sep).join('/');
    if (path === exclude || references.has(rel) || rel.startsWith(`${REFERENCES_DIR}/`)) continue;
    const text = await documents.readDocument(path).then((d) => d.text, () => null);
    if (text === null) {
      out.omitted.push(rel);
      continue;
    }
    if (text.length > budget) {
      out.omitted.push(rel);
      continue;
    }
    budget -= text.length;
    out.attachments.push({ name: rel, kind: 'text', text });
    out.included.push(rel);
  }
  return out;
}
