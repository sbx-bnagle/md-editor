import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import {
  META_DIR,
  PROJECT_FILE,
  isHiddenName,
  isMarkdownFile,
  paths,
  serializeWithAnnotations,
  splitAnnotations,
  validateName,
  type DocumentFile,
  type FileEntry,
  type ProjectDetails,
  type ProjectMeta,
  type ProjectPdf,
  type SaveDocumentRequest,
  type TransferRequest,
  type TransferResult,
} from '@mde/core';
import { assetUrlFor } from './assets';
import { copyDir, exists, naturalCompare, replaceTaggedFile, uniqueName } from './fsutil';
import { pdfInfo } from './pdfInserts';
import { UserError, type LibraryService } from './library';
import type { ThemeService } from './themes';
import type { HostAdapter } from './host';

export async function listTree(dir: string): Promise<FileEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: FileEntry[] = [];
  for (const e of entries) {
    if (isHiddenName(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push({ name: e.name, path, type: 'dir', children: await listTree(path) });
    else if (e.isFile()) out.push({ name: e.name, path, type: 'file' });
  }
  return out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : naturalCompare(a.name, b.name)));
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** A file's text. One that is not UTF-8 is refused: opened as UTF-8 and saved, its other characters would be lost. */
function utf8Text(bytes: Uint8Array, path: string): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new UserError(`“${basename(path)}” is not UTF-8 text, so it is not opened (saving it here would damage it). Convert it to UTF-8 in another app first.`);
  }
}

export class DocumentService {
  constructor(
    private readonly library: LibraryService,
    private readonly themes: ThemeService,
    private readonly host: HostAdapter,
  ) {}

  async details(projectPath: string): Promise<ProjectDetails> {
    this.library.assertInside(projectPath);
    return {
      ref: this.library.refFor(projectPath),
      meta: await this.library.readMeta(projectPath),
      files: await listTree(projectPath),
      themes: await this.themes.list(projectPath),
    };
  }

  private metaWrites = new Map<string, Promise<unknown>>();

  /** Changes project.json, one change at a time per project, so two at once do not overwrite each other. */
  async modifyMeta(projectPath: string, change: (meta: ProjectMeta) => Partial<ProjectMeta>): Promise<ProjectMeta> {
    this.library.assertInside(projectPath);
    const next = (this.metaWrites.get(projectPath) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const current = await this.library.readMeta(projectPath);
        const meta = { ...current, ...change(current), format: 1 as const };
        await this.library.writeMeta(projectPath, meta);
        return meta;
      });
    this.metaWrites.set(projectPath, next);
    try {
      return await next;
    } finally {
      if (this.metaWrites.get(projectPath) === next) this.metaWrites.delete(projectPath);
    }
  }

  async updateMeta(projectPath: string, patch: Partial<ProjectMeta>): Promise<ProjectMeta> {
    return this.modifyMeta(projectPath, () => patch);
  }

  async documents(projectPath: string): Promise<string[]> {
    this.library.assertInside(projectPath);
    const out: string[] = [];
    const walk = (entries: FileEntry[]) => {
      for (const e of entries) {
        if (e.type === 'dir') walk(e.children ?? []);
        else if (isMarkdownFile(e.path)) out.push(e.path);
      }
    };
    walk(await listTree(projectPath));
    return out;
  }

  async pdfs(projectPath: string): Promise<ProjectPdf[]> {
    this.library.assertInside(projectPath);
    const found: string[] = [];
    const walk = (entries: FileEntry[]) => {
      for (const e of entries) {
        if (e.type === 'dir') walk(e.children ?? []);
        else if (extname(e.path).toLowerCase() === '.pdf') found.push(e.path);
      }
    };
    walk(await listTree(projectPath));
    return Promise.all(
      found.map(async (path): Promise<ProjectPdf> => {
        const rel = relative(projectPath, path).split(sep).join('/');
        const st = await fs.stat(path);
        const info = await pdfInfo(path, st, async () => new Uint8Array(await fs.readFile(path)));
        return 'error' in info ? { path, rel, url: assetUrlFor(path), error: info.error } : { path, rel, url: assetUrlFor(path), pages: info.pages, unembeddedFonts: info.unembeddedFonts };
      }),
    );
  }

  async importFiles(projectPath: string, sources: string[], folder: string): Promise<string[]> {
    this.library.assertInside(projectPath);
    const err = validateName(folder);
    if (err) throw new UserError(err);
    const dir = join(projectPath, folder);
    await this.library.assertWritable(dir);
    await fs.mkdir(dir, { recursive: true });
    const out: string[] = [];
    for (const src of sources) {
      const ext = extname(src);
      const dest = join(dir, await uniqueName(dir, basename(src, ext), ext));
      await fs.copyFile(src, dest);
      out.push(dest);
    }
    return out;
  }

  async readDocument(path: string): Promise<DocumentFile> {
    this.library.assertInside(path);
    const [bytes, stat] = await Promise.all([fs.readFile(path), fs.stat(path)]);
    const text = utf8Text(bytes, path).replace(/\r\n?/g, '\n');
    const split = splitAnnotations(text);
    return {
      path,
      text: split.text,
      annotations: split.block,
      annotationStatus: split.block ? (split.valid ? 'valid' : 'invalid') : 'none',
      mtimeMs: stat.mtimeMs,
    };
  }

  async saveDocument(req: SaveDocumentRequest): Promise<{ mtimeMs: number }> {
    await this.library.assertWritable(req.path);
    let out = req.text;
    if (req.annotations || (req.spans && req.spans.length)) {
      const block = req.annotations;
      out = serializeWithAnnotations(req.text, req.spans ?? [], {
        authors: block?.authors.map((a) => a.key),
        hashKey: block?.hashKey,
        other: block?.other,
        authorContent: Object.fromEntries((block?.authors ?? []).filter((a) => a.content).map((a) => [a.key, a.content])),
      });
    }
    await replaceTaggedFile(this.host, req.path, out);
    return { mtimeMs: (await fs.stat(req.path)).mtimeMs };
  }

  async readText(path: string): Promise<string> {
    this.library.assertInside(path);
    return utf8Text(await fs.readFile(path), path);
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.library.assertWritable(path);
    await replaceTaggedFile(this.host, path, text);
  }

  async createFile(dir: string, name: string, content = ''): Promise<string> {
    await this.library.assertWritable(dir);
    const err = validateName(name);
    if (err) throw new UserError(err);
    const p = join(dir, name);
    if (await exists(p)) throw new UserError(`“${name}” already exists.`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(p, content, { flag: 'wx' });
    this.host.emit({ type: 'library-changed' });
    return p;
  }

  /**
   * Moves or copies a file or folder (dragged in the library, or dropped from Finder) into a project
   * or a folder inside one. A name that is taken is reported unless `conflict` says what to do.
   */
  async transfer(req: TransferRequest): Promise<TransferResult> {
    const root = this.library.requireRoot();
    const target = await this.library.assertWritable(req.targetDir);
    const targetProject = this.library.projectFor(target);
    if (!targetProject || relative(targetProject, target).split(sep)[0] === META_DIR || !(await fs.stat(target).catch(() => null))?.isDirectory()) {
      throw new UserError('Files and folders can be put in a project or a folder inside one.');
    }
    const source = req.source;
    const name = basename(source);
    const st = await fs.lstat(source).catch(() => null);
    if (!st) throw new UserError(`“${name}” was not found.`);
    if (st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) throw new UserError(`“${name}” is a link or a special file; only files and folders can be added.`);
    if (paths.isInside(source, root)) {
      const project = this.library.projectFor(source);
      const rel = project ? relative(project, source) : '';
      if (!project || !rel || rel.split(sep)[0] === META_DIR) throw new UserError('Only files and folders inside a project can be moved.');
      await this.library.assertWritable(source);
    } else {
      if (paths.isInside(root, source)) throw new UserError(`“${name}” holds the library, so it cannot be put into it.`);
      if (st.isDirectory() && (await exists(join(source, META_DIR, PROJECT_FILE)))) throw new UserError(`“${name}” is a project; put it in a collection folder instead.`);
    }
    if (st.isDirectory() && paths.isInside(target, source)) throw new UserError(`“${name}” cannot be put inside itself.`);
    const sameFolder = dirname(source) === target;
    if (sameFolder && !req.copy) return { path: source };
    let dest = join(target, name);
    if (await exists(dest)) {
      // A copy into its own folder is a duplicate, named as Finder names copies.
      const choice = sameFolder ? 'keep-both' : req.conflict;
      if (!choice) return { conflict: name };
      if (choice === 'replace') {
        if (paths.isInside(source, dest)) throw new UserError(`The “${name}” there holds the item being moved, so it cannot be replaced.`);
        await this.library.assertWritable(dest);
        await this.host.trash(dest);
      } else {
        const ext = st.isDirectory() ? '' : extname(name);
        dest = join(target, await uniqueName(target, basename(name, ext), ext));
      }
    }
    const copy = () => (st.isDirectory() ? copyDir(source, dest, (rel) => basename(rel) === '.DS_Store') : fs.copyFile(source, dest));
    if (req.copy) await copy();
    else {
      try {
        await fs.rename(source, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
        // On another volume: copy, then put the original in the Trash (it can be taken back from there).
        await copy();
        await this.host.trash(source);
      }
    }
    this.host.emit({ type: 'library-changed' });
    return { path: dest };
  }

  async createFolder(dir: string, name: string): Promise<string> {
    await this.library.assertWritable(dir);
    const err = validateName(name);
    if (err) throw new UserError(err);
    const p = join(dir, name);
    if (await exists(p)) throw new UserError(`“${name}” already exists.`);
    await fs.mkdir(p, { recursive: true });
    this.host.emit({ type: 'library-changed' });
    return p;
  }
}
