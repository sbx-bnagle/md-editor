// The file tree a mount keeps in memory. Mounts are folders of the web app's file system: the app's
// own files (seed library, thesaurus), the browser's storage (settings), and the library in Dropbox
// or Google Drive. Each keeps its whole tree in memory and loads file contents when first read;
// subclasses persist changes (hooks below) and fill the tree.

export interface FileNode {
  kind: 'file';
  mtimeMs: number;
  size: number;
  ino: number;
  /** Contents, once loaded; null until read. */
  data: Uint8Array | null;
  /** The storage's own details (Dropbox rev, Drive id and version). */
  meta?: Record<string, unknown>;
}

export interface DirNode {
  kind: 'dir';
  mtimeMs: number;
  ino: number;
  children: Map<string, Node>;
  meta?: Record<string, unknown>;
}

export type Node = FileNode | DirNode;

let inodes = 1;
export const nextIno = () => ++inodes;

export const newDir = (mtimeMs = Date.now(), meta?: Record<string, unknown>): DirNode => ({ kind: 'dir', mtimeMs, ino: nextIno(), children: new Map(), meta });
export const newFile = (data: Uint8Array | null, size: number, mtimeMs = Date.now(), meta?: Record<string, unknown>): FileNode => ({ kind: 'file', mtimeMs, size, ino: nextIno(), data, meta });

/** An error as Node's fs gives it: the code is in the message and on `code`. */
export function fsError(code: string, syscall: string, path: string): Error & { code: string } {
  const text: Record<string, string> = {
    ENOENT: 'no such file or directory',
    EEXIST: 'file already exists',
    ENOTDIR: 'not a directory',
    EISDIR: 'illegal operation on a directory',
    ENOTEMPTY: 'directory not empty',
    EROFS: 'read-only file system',
    EXDEV: 'cross-device link not permitted',
    EACCES: 'permission denied',
    EIO: 'i/o error',
  };
  return Object.assign(new Error(`${code}: ${text[code] ?? 'error'}, ${syscall} '${path}'`), { code });
}

export const splitRel = (rel: string): string[] => rel.split('/').filter(Boolean);

export abstract class TreeMount {
  root: DirNode = newDir();
  readonly readOnly: boolean = false;

  /** `mountPoint` is the absolute path of the mount's root ("/app"). */
  constructor(readonly mountPoint: string) {}

  /** Loads a file's contents that are not in memory yet. */
  protected abstract load(rel: string, node: FileNode): Promise<Uint8Array>;

  // Persistence hooks, called after the tree changed.
  protected afterWrite(_rel: string, _node: FileNode): void | Promise<void> {}
  protected afterMkdir(_rel: string, _node: DirNode): void | Promise<void> {}
  protected afterRename(_from: string, _to: string, _node: Node, _replaced: Node | null): void | Promise<void> {}
  protected afterRemove(_rel: string, _node: Node): void | Promise<void> {}

  lookup(rel: string): Node | null {
    let node: Node = this.root;
    for (const part of splitRel(rel)) {
      if (node.kind !== 'dir') return null;
      const next = node.children.get(part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /** The folder holding `rel` and the last part of its name. */
  protected parentOf(rel: string, syscall: string, abs: string): { dir: DirNode; name: string } {
    const parts = splitRel(rel);
    const name = parts.pop();
    if (!name) throw fsError('EEXIST', syscall, abs);
    const dir = this.lookup(parts.join('/'));
    if (!dir) throw fsError('ENOENT', syscall, abs);
    if (dir.kind !== 'dir') throw fsError('ENOTDIR', syscall, abs);
    return { dir, name };
  }

  private writable(syscall: string, abs: string): void {
    if (this.readOnly) throw fsError('EROFS', syscall, abs);
  }

  async read(rel: string, abs: string): Promise<Uint8Array> {
    const node = this.lookup(rel);
    if (!node) throw fsError('ENOENT', 'open', abs);
    if (node.kind === 'dir') throw fsError('EISDIR', 'read', abs);
    if (!node.data) {
      const data = await this.load(rel, node);
      // The file may have changed while it loaded; the newer contents win.
      if (!node.data) {
        node.data = data;
        node.size = data.length;
      }
    }
    return node.data!;
  }

  async write(rel: string, abs: string, data: Uint8Array, flag: 'w' | 'wx' | 'a' = 'w'): Promise<void> {
    this.writable('open', abs);
    const { dir, name } = this.parentOf(rel, 'open', abs);
    const existing = dir.children.get(name);
    if (existing?.kind === 'dir') throw fsError('EISDIR', 'open', abs);
    if (existing && flag === 'wx') throw fsError('EEXIST', 'open', abs);
    let bytes = data;
    if (flag === 'a' && existing) {
      const before = await this.read(rel, abs);
      bytes = new Uint8Array(before.length + data.length);
      bytes.set(before);
      bytes.set(data, before.length);
    }
    const node = existing ?? newFile(null, 0);
    node.data = bytes;
    node.size = bytes.length;
    node.mtimeMs = Date.now();
    dir.children.set(name, node);
    dir.mtimeMs = node.mtimeMs;
    await this.afterWrite(rel, node);
  }

  async mkdir(rel: string, abs: string, recursive: boolean): Promise<void> {
    this.writable('mkdir', abs);
    const parts = splitRel(rel);
    let node: DirNode = this.root;
    for (let i = 0; i < parts.length; i++) {
      const next = node.children.get(parts[i]);
      const last = i === parts.length - 1;
      if (next) {
        if (next.kind !== 'dir') throw fsError(last ? 'EEXIST' : 'ENOTDIR', 'mkdir', abs);
        if (last && !recursive) throw fsError('EEXIST', 'mkdir', abs);
        node = next;
        continue;
      }
      if (!last && !recursive) throw fsError('ENOENT', 'mkdir', abs);
      const dir = newDir();
      node.children.set(parts[i], dir);
      node.mtimeMs = dir.mtimeMs;
      await this.afterMkdir(parts.slice(0, i + 1).join('/'), dir);
      node = dir;
    }
  }

  async rename(from: string, to: string, absFrom: string, absTo: string): Promise<void> {
    this.writable('rename', absFrom);
    const src = this.parentOf(from, 'rename', absFrom);
    const node = src.dir.children.get(src.name);
    if (!node) throw fsError('ENOENT', 'rename', absFrom);
    const dst = this.parentOf(to, 'rename', absTo);
    const replaced = dst.dir.children.get(dst.name) ?? null;
    if (replaced === node) return;
    if (node.kind === 'dir' && (`${to}/`.startsWith(`${from}/`) || to === from)) throw fsError('EINVAL', 'rename', absFrom);
    if (replaced?.kind === 'dir' && (node.kind !== 'dir' || replaced.children.size)) throw fsError(node.kind === 'dir' ? 'ENOTEMPTY' : 'EISDIR', 'rename', absTo);
    if (replaced && replaced.kind !== 'dir' && node.kind === 'dir') throw fsError('ENOTDIR', 'rename', absTo);
    src.dir.children.delete(src.name);
    dst.dir.children.set(dst.name, node);
    src.dir.mtimeMs = dst.dir.mtimeMs = Date.now();
    await this.afterRename(from, to, node, replaced);
  }

  async remove(rel: string, abs: string, recursive: boolean): Promise<void> {
    this.writable('rm', abs);
    const { dir, name } = this.parentOf(rel, 'rm', abs);
    const node = dir.children.get(name);
    if (!node) throw fsError('ENOENT', 'rm', abs);
    if (node.kind === 'dir' && node.children.size && !recursive) throw fsError('ENOTEMPTY', 'rmdir', abs);
    dir.children.delete(name);
    dir.mtimeMs = Date.now();
    await this.afterRemove(rel, node);
  }

  /** Every file under `rel` (itself when it is a file), with relative paths. */
  walk(rel = '', node: Node | null = this.lookup(rel)): Array<{ rel: string; node: FileNode }> {
    if (!node) return [];
    if (node.kind === 'file') return [{ rel, node }];
    const out: Array<{ rel: string; node: FileNode }> = [];
    for (const [name, child] of node.children) out.push(...this.walk(rel ? `${rel}/${name}` : name, child));
    return out;
  }
}
