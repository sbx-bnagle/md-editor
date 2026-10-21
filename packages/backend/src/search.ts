// Library search for the sidebar: names of collections, projects, folders and files, and the
// text of text files, in Collections/. File text is cached by modification time.

import { promises as fs } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { LIBRARY_DIRS, matchesAll, matchingLines, searchTerms, splitAnnotations, type FileEntry, type LibrarySearchHit, type LibrarySearchResult } from '@mde/core';
import { listTree } from './documents';
import type { LibraryService } from './library';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.txt', '.text', '.csv', '.tsv', '.json', '.yaml', '.yml', '.mmd', '.mermaid', '.css', '.html', '.htm']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_HITS = 200;

export class SearchService {
  private texts = new Map<string, { mtimeMs: number; size: number; text: string }>();

  constructor(private readonly library: LibraryService) {}

  private async text(path: string): Promise<string | null> {
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return null;
    const st = await fs.stat(path).catch(() => null);
    if (!st || st.size > MAX_FILE_BYTES) return null;
    const hit = this.texts.get(path);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.text;
    const text = splitAnnotations((await fs.readFile(path, 'utf8')).replace(/\r\n?/g, '\n')).text;
    this.texts.set(path, { mtimeMs: st.mtimeMs, size: st.size, text });
    return text;
  }

  async search(query: string): Promise<LibrarySearchResult> {
    const terms = searchTerms(query);
    const hits: LibrarySearchHit[] = [];
    if (!terms.length) return { query, hits, truncated: false };
    const collectionsDir = join(this.library.requireRoot(), LIBRARY_DIRS.collections);
    let truncated = false;
    const add = (hit: LibrarySearchHit) => {
      if (hits.length >= MAX_HITS) truncated = true;
      else hits.push(hit);
    };
    for (const c of await listTree(collectionsDir)) {
      if (c.type !== 'dir') continue;
      if (matchesAll(c.name, terms)) add({ path: c.path, kind: 'collection', collection: c.name, collectionPath: c.path, nameMatch: true });
      for (const p of c.children ?? []) {
        if (p.type !== 'dir') continue;
        const where = { collection: c.name, collectionPath: c.path, project: p.name, projectPath: p.path };
        if (matchesAll(p.name, terms)) add({ path: p.path, kind: 'project', ...where, nameMatch: true });
        const walk = async (entries: FileEntry[]) => {
          for (const e of entries) {
            if (truncated) return;
            const rel = relative(p.path, e.path).split(sep).join('/');
            const nameMatch = matchesAll(e.name, terms);
            if (e.type === 'dir') {
              if (nameMatch) add({ path: e.path, kind: 'folder', ...where, rel, nameMatch });
              await walk(e.children ?? []);
              continue;
            }
            const text = await this.text(e.path);
            const lines = text === null ? null : matchingLines(text, terms);
            if (nameMatch || lines) add({ path: e.path, kind: 'file', ...where, rel, nameMatch, ...(lines ? { lines } : {}) });
          }
        };
        await walk(p.children ?? []);
      }
    }
    return { query, hits, truncated };
  }
}
