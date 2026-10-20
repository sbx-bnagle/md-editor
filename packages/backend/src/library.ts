import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
  HISTORY_FILE,
  LIBRARY_DIRS,
  LIBRARY_FILE,
  META_DIR,
  PROJECT_FILE,
  defaultProjectMeta,
  isHiddenName,
  validateName,
  type CollectionInfo,
  type LibraryTree,
  type ProjectMeta,
  type ProjectRef,
} from '@mde/core';
import { copyDir, exists, isDir, naturalCompare, readJson, uniqueName, writeJson } from './fsutil';
import type { HostAdapter } from './host';
import type { ThemeService } from './themes';

export class UserError extends Error {
  readonly userFacing = true;
}

export class LibraryService {
  root: string | null = null;

  constructor(
    private readonly host: HostAdapter,
    /** Folder with the seed content copied into a new library. */
    private readonly seedDir: string,
    private readonly themes: () => ThemeService,
  ) {}

  requireRoot(): string {
    if (!this.root) throw new UserError('No library is open.');
    return this.root;
  }

  /** Throws unless `p` is inside the open library. Guards every path coming from the UI. */
  assertInside(p: string): string {
    const root = this.requireRoot();
    const rel = relative(root, p);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || p.includes('\0') || !p.startsWith('/')) {
      throw new UserError(`Path is outside the library: ${p}`);
    }
    return p;
  }

  async open(path: string, create: boolean): Promise<void> {
    if (create) {
      await fs.mkdir(path, { recursive: true });
      const fresh = !(await exists(join(path, META_DIR, LIBRARY_FILE)));
      for (const d of Object.values(LIBRARY_DIRS)) await fs.mkdir(join(path, d), { recursive: true });
      if (fresh) {
        await writeJson(join(path, META_DIR, LIBRARY_FILE), { format: 1, created: new Date().toISOString() });
        if (await isDir(this.seedDir)) {
          // Seed only folders that are empty so an existing folder's content is never overwritten.
          for (const d of Object.values(LIBRARY_DIRS)) {
            const src = join(this.seedDir, d);
            const dest = join(path, d);
            if ((await isDir(src)) && (await fs.readdir(dest)).filter((n) => !isHiddenName(n)).length === 0) await copyDir(src, dest);
          }
        }
      }
    } else if (!(await isDir(path))) {
      throw new UserError(`Folder not found: ${path}`);
    } else {
      for (const d of Object.values(LIBRARY_DIRS)) await fs.mkdir(join(path, d), { recursive: true });
    }
    this.root = path;
  }

  private async listDirs(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && !isHiddenName(e.name)).map((e) => e.name).sort(naturalCompare);
    } catch {
      return [];
    }
  }

  async tree(): Promise<LibraryTree> {
    const root = this.requireRoot();
    const collectionsDir = join(root, LIBRARY_DIRS.collections);
    const collections: CollectionInfo[] = [];
    for (const c of await this.listDirs(collectionsDir)) {
      const cPath = join(collectionsDir, c);
      const projects: ProjectRef[] = (await this.listDirs(cPath)).map((p) => ({ name: p, path: join(cPath, p), kind: 'project', collection: c }));
      collections.push({ name: c, path: cPath, projects });
    }
    const templatesDir = join(root, LIBRARY_DIRS.templates);
    const templates: ProjectRef[] = (await this.listDirs(templatesDir)).map((t) => ({ name: t, path: join(templatesDir, t), kind: 'template' }));
    return { root, collections, templates, themes: await this.themes().list() };
  }

  /** Project or template folder containing `p`, or null. */
  projectFor(p: string): string | null {
    const root = this.requireRoot();
    const rel = relative(root, p).split(sep);
    if (rel[0] === LIBRARY_DIRS.collections && rel.length >= 3) return join(root, rel[0], rel[1], rel[2]);
    if (rel[0] === LIBRARY_DIRS.templates && rel.length >= 2) return join(root, rel[0], rel[1]);
    return null;
  }

  refFor(projectPath: string): ProjectRef {
    const root = this.requireRoot();
    const rel = relative(root, projectPath).split(sep);
    if (rel[0] === LIBRARY_DIRS.templates) return { name: rel[1], path: projectPath, kind: 'template' };
    return { name: rel[2], path: projectPath, kind: 'project', collection: rel[1] };
  }

  async readMeta(projectPath: string): Promise<ProjectMeta> {
    const kind = this.refFor(projectPath).kind;
    const meta = await readJson<ProjectMeta | null>(join(projectPath, META_DIR, PROJECT_FILE), null);
    return meta ? { ...meta, kind } : defaultProjectMeta(kind, new Date());
  }

  async writeMeta(projectPath: string, meta: ProjectMeta): Promise<void> {
    await writeJson(join(projectPath, META_DIR, PROJECT_FILE), meta);
  }

  async createCollection(name: string): Promise<string> {
    const err = validateName(name);
    if (err) throw new UserError(err);
    const p = join(this.requireRoot(), LIBRARY_DIRS.collections, name);
    if (await exists(p)) throw new UserError(`A collection named “${name}” already exists.`);
    await fs.mkdir(p, { recursive: true });
    this.host.emit({ type: 'library-changed' });
    return p;
  }

  async createProject(req: { collection: string; name: string; template?: string }): Promise<string> {
    const err = validateName(req.name) ?? validateName(req.collection);
    if (err) throw new UserError(err);
    const root = this.requireRoot();
    const cPath = join(root, LIBRARY_DIRS.collections, req.collection);
    if (!(await isDir(cPath))) throw new UserError(`Collection “${req.collection}” does not exist.`);
    const p = join(cPath, req.name);
    if (await exists(p)) throw new UserError(`“${req.name}” already exists in ${req.collection}.`);
    let meta = defaultProjectMeta('project', new Date());
    if (req.template) {
      const tPath = join(root, LIBRARY_DIRS.templates, req.template);
      if (!(await isDir(tPath))) throw new UserError(`Template “${req.template}” does not exist.`);
      await copyDir(tPath, p, (rel) => rel === `${META_DIR}/${HISTORY_FILE}` || basename(rel) === '.DS_Store');
      meta = { ...(await this.readMeta(p)), kind: 'project', created: new Date().toISOString() };
    } else {
      await fs.mkdir(p, { recursive: true });
      await fs.writeFile(join(p, 'main.md'), `---\ntitle: ${req.name}\n---\n\n# {{title}}\n\n`);
    }
    await this.writeMeta(p, meta);
    this.host.emit({ type: 'library-changed' });
    return p;
  }

  async createTemplate(req: { name: string; fromProject?: string }): Promise<string> {
    const err = validateName(req.name);
    if (err) throw new UserError(err);
    const p = join(this.requireRoot(), LIBRARY_DIRS.templates, req.name);
    if (await exists(p)) throw new UserError(`A template named “${req.name}” already exists.`);
    let meta = defaultProjectMeta('template', new Date());
    if (req.fromProject) {
      this.assertInside(req.fromProject);
      await copyDir(req.fromProject, p, (rel) => rel === `${META_DIR}/${HISTORY_FILE}` || basename(rel) === '.DS_Store');
      meta = { ...(await this.readMeta(req.fromProject)), kind: 'template', created: new Date().toISOString() };
    } else {
      await fs.mkdir(p, { recursive: true });
      await fs.writeFile(join(p, 'main.md'), '---\ntitle: Untitled\n---\n\n# {{title}}\n\n');
    }
    await this.writeMeta(p, meta);
    this.host.emit({ type: 'library-changed' });
    return p;
  }

  async rename(path: string, newName: string): Promise<string> {
    this.assertInside(path);
    const err = validateName(newName);
    if (err) throw new UserError(err);
    const dest = join(dirname(path), newName);
    if (dest === path) return path;
    if (await exists(dest)) {
      // Allow case-only renames on case-insensitive volumes.
      if (dest.toLowerCase() !== path.toLowerCase()) throw new UserError(`“${newName}” already exists.`);
    }
    await fs.rename(path, dest);
    this.host.emit({ type: 'library-changed' });
    return dest;
  }

  async trash(path: string): Promise<void> {
    this.assertInside(path);
    const root = this.requireRoot();
    const rel = relative(root, path);
    if (Object.values(LIBRARY_DIRS).includes(rel as never) || rel === '' || rel === META_DIR) {
      throw new UserError('Library folders cannot be moved to the Trash.');
    }
    await this.host.trash(path);
    this.host.emit({ type: 'library-changed' });
  }

  async uniqueChild(dir: string, base: string, ext = ''): Promise<string> {
    return uniqueName(dir, base, ext);
  }
}
