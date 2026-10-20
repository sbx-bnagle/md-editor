import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_THEME,
  LIBRARY_DIRS,
  META_DIR,
  PROJECT_THEMES_DIR,
  THEME_CSS,
  isHiddenName,
  validateName,
  type ThemeInfo,
} from '@mde/core';
import { copyDir, exists, isDir, isFile, naturalCompare } from './fsutil';
import { UserError, type LibraryService } from './library';
import type { HostAdapter } from './host';

/** Used when no theme can be found, so documents always render. */
export const FALLBACK_THEME_CSS = `@page { size: letter; margin: 1in; @bottom-center { content: counter(page); } }
body { font-family: Georgia, serif; font-size: 11pt; line-height: 1.5; }
`;

export class ThemeService {
  constructor(
    private readonly library: LibraryService,
    private readonly host: HostAdapter,
  ) {}

  private async scan(dir: string, scope: ThemeInfo['scope']): Promise<ThemeInfo[]> {
    if (!(await isDir(dir))) return [];
    const out: ThemeInfo[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || isHiddenName(e.name)) continue;
      const path = join(dir, e.name);
      const cssPath = join(path, THEME_CSS);
      if (await isFile(cssPath)) out.push({ name: e.name, path, cssPath, scope });
    }
    return out.sort((a, b) => naturalCompare(a.name, b.name));
  }

  libraryDir(): string {
    return join(this.library.requireRoot(), LIBRARY_DIRS.themes);
  }

  /** Library themes, plus project forks (which shadow library themes of the same name). */
  async list(projectPath?: string): Promise<ThemeInfo[]> {
    const lib = await this.scan(this.libraryDir(), 'library');
    if (!projectPath) return lib;
    const forks = await this.scan(join(projectPath, META_DIR, PROJECT_THEMES_DIR), 'project');
    const names = new Set(forks.map((f) => f.name));
    return [...forks, ...lib.filter((t) => !names.has(t.name))].sort((a, b) => naturalCompare(a.name, b.name));
  }

  async resolve(name: string | undefined, projectPath: string | null): Promise<ThemeInfo | null> {
    const all = await this.list(projectPath ?? undefined);
    return all.find((t) => t.name === (name ?? DEFAULT_THEME)) ?? all.find((t) => t.name === DEFAULT_THEME) ?? all[0] ?? null;
  }

  async create(name: string, from?: string): Promise<ThemeInfo> {
    const err = validateName(name);
    if (err) throw new UserError(err);
    const dest = join(this.libraryDir(), name);
    if (await exists(dest)) throw new UserError(`A theme named “${name}” already exists.`);
    if (from) {
      const src = (await this.list()).find((t) => t.name === from);
      if (!src) throw new UserError(`Theme “${from}” not found.`);
      await copyDir(src.path, dest);
    } else {
      await fs.mkdir(dest, { recursive: true });
      await fs.writeFile(join(dest, THEME_CSS), FALLBACK_THEME_CSS);
    }
    this.host.emit({ type: 'library-changed' });
    return { name, path: dest, cssPath: join(dest, THEME_CSS), scope: 'library' };
  }

  async fork(projectPath: string, themeName: string): Promise<ThemeInfo> {
    this.library.assertInside(projectPath);
    const src = (await this.list()).find((t) => t.name === themeName);
    if (!src) throw new UserError(`Theme “${themeName}” not found.`);
    const dest = join(projectPath, META_DIR, PROJECT_THEMES_DIR, themeName);
    if (!(await exists(dest))) await copyDir(src.path, dest);
    this.host.emit({ type: 'library-changed' });
    return { name: themeName, path: dest, cssPath: join(dest, THEME_CSS), scope: 'project' };
  }
}
