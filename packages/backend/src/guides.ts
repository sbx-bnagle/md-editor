import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { GUIDE_DIRS, LIBRARY_DIRS, isHiddenName, validateName, type GuideInfo } from '@mde/core';
import { exists, isDir, naturalCompare } from './fsutil';
import { UserError, type LibraryService } from './library';
import type { HostAdapter } from './host';

const BLANK: Record<GuideInfo['kind'], string> = {
  voice: '# Voice\n\nDescribe how the writing should sound: who it speaks to, sentence length, word choice, what to avoid. The AI reads this guide when it drafts.\n',
  style: '---\nbase: none\nrules:\n  quotes: curly\n---\n\nNotes for the AI reviewer: anything the rules above cannot check.\n',
};

export class GuideService {
  constructor(
    private readonly library: LibraryService,
    private readonly host: HostAdapter,
  ) {}

  private dir(kind: GuideInfo['kind']): string {
    return join(this.library.requireRoot(), LIBRARY_DIRS.guides, GUIDE_DIRS[kind]);
  }

  async list(): Promise<GuideInfo[]> {
    const out: GuideInfo[] = [];
    for (const kind of ['voice', 'style'] as const) {
      const dir = this.dir(kind);
      if (!(await isDir(dir))) continue;
      for (const name of (await fs.readdir(dir)).sort(naturalCompare)) {
        if (isHiddenName(name) || !name.endsWith('.md')) continue;
        out.push({ kind, name: name.slice(0, -3), path: join(dir, name) });
      }
    }
    return out;
  }

  async create(kind: GuideInfo['kind'], name: string, from?: string): Promise<GuideInfo> {
    const err = validateName(name);
    if (err) throw new UserError(err);
    const path = join(this.dir(kind), `${name}.md`);
    if (await exists(path)) throw new UserError(`A ${kind} guide named “${name}” already exists.`);
    let text = BLANK[kind];
    if (from) {
      const src = (await this.list()).find((g) => g.kind === kind && g.name === from);
      if (src) text = await fs.readFile(src.path, 'utf8');
    }
    await fs.mkdir(this.dir(kind), { recursive: true });
    await fs.writeFile(path, text, { flag: 'wx' });
    this.host.emit({ type: 'library-changed' });
    return { kind, name, path };
  }
}
