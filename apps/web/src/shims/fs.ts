// node:fs for the backend in the browser. Every path belongs to a mount of the web app's file system
// (vfs/mounts.ts): the app's own files, this browser's storage, or the library in the cloud.
//
// Only what the backend uses is here: the promise API, open() for whole-file writes and ranged
// reads, createWriteStream (collected, then written), and watch (changes made elsewhere).

import { vfs } from '../vfs/mounts';
import { fsError, type Node } from '../vfs/tree';
import { BufferLike, decode, type BufferEncoding } from './buffer';

export class Stats {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
  readonly mode: number;
  readonly ino: number;
  readonly dev = 1;

  constructor(private readonly node: Node) {
    this.size = node.kind === 'file' ? node.size : 0;
    this.mtimeMs = this.ctimeMs = this.birthtimeMs = node.mtimeMs;
    this.mode = node.kind === 'dir' ? 0o40755 : 0o100644;
    this.ino = node.ino;
  }

  get mtime(): Date {
    return new Date(this.mtimeMs);
  }

  get ctime(): Date {
    return new Date(this.ctimeMs);
  }

  get birthtime(): Date {
    return new Date(this.birthtimeMs);
  }

  isFile(): boolean {
    return this.node.kind === 'file';
  }

  isDirectory(): boolean {
    return this.node.kind === 'dir';
  }

  isSymbolicLink(): boolean {
    return false;
  }
}

export class Dirent {
  constructor(
    readonly name: string,
    private readonly kind: 'file' | 'dir',
  ) {}

  isFile(): boolean {
    return this.kind === 'file';
  }

  isDirectory(): boolean {
    return this.kind === 'dir';
  }

  isSymbolicLink(): boolean {
    return false;
  }
}

type Encodingish = BufferEncoding | null | undefined | { encoding?: BufferEncoding | null; flag?: string; mode?: number };
type Data = string | Uint8Array;

const encodingOf = (o: Encodingish): BufferEncoding | null => (typeof o === 'string' ? o : (o?.encoding ?? null));
const bytesOf = (data: Data): Uint8Array => (typeof data === 'string' ? new TextEncoder().encode(data) : data);

function at(path: string, syscall: string) {
  const r = vfs.resolve(path);
  if (!r) throw fsError('ENOENT', syscall, path);
  return r;
}

/** A folder above the mounts ("/", "/Google Drive"), which holds only mounts. */
function virtualDir(path: string): Node | null {
  return vfs.virtualChildren(path) ? { kind: 'dir', mtimeMs: 0, ino: 1, children: new Map() } : null;
}

async function readFile(path: string): Promise<BufferLike>;
async function readFile(path: string, options: BufferEncoding | { encoding: BufferEncoding }): Promise<string>;
async function readFile(path: string, options?: Encodingish): Promise<BufferLike | string>;
async function readFile(path: string, options?: Encodingish): Promise<BufferLike | string> {
  const { mount, rel } = at(path, 'open');
  const bytes = BufferLike.fromBytes((await mount.read(rel, path)).slice());
  const encoding = encodingOf(options);
  return encoding ? decode(bytes, encoding) : bytes;
}

async function writeFile(path: string, data: Data, options?: Encodingish): Promise<void> {
  const flag = typeof options === 'object' && options?.flag === 'wx' ? 'wx' : 'w';
  const { mount, rel } = at(path, 'open');
  await mount.write(rel, path, bytesOf(data).slice(), flag);
}

async function appendFile(path: string, data: Data): Promise<void> {
  const { mount, rel } = at(path, 'open');
  await mount.write(rel, path, bytesOf(data).slice(), 'a');
}

async function stat(path: string): Promise<Stats> {
  const r = vfs.resolve(path);
  const node = r ? r.mount.lookup(r.rel) : virtualDir(path);
  if (!node) throw fsError('ENOENT', 'stat', path);
  return new Stats(node);
}

const lstat = stat;

async function access(path: string): Promise<void> {
  await stat(path);
}

async function readdir(path: string): Promise<string[]>;
async function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
async function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
  const r = vfs.resolve(path);
  let entries: Array<[string, 'file' | 'dir']>;
  if (!r) {
    const names = vfs.virtualChildren(path);
    if (!names) throw fsError('ENOENT', 'scandir', path);
    entries = names.map((n) => [n, 'dir']);
  } else {
    const node = r.mount.lookup(r.rel);
    if (!node) throw fsError('ENOENT', 'scandir', path);
    if (node.kind !== 'dir') throw fsError('ENOTDIR', 'scandir', path);
    entries = [...node.children].map(([name, child]) => [name, child.kind]);
  }
  return options?.withFileTypes ? entries.map(([name, kind]) => new Dirent(name, kind)) : entries.map(([name]) => name);
}

async function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined> {
  const r = vfs.resolve(path);
  if (!r) {
    if (vfs.virtualChildren(path) && options?.recursive) return undefined;
    throw fsError(vfs.virtualChildren(path) ? 'EEXIST' : 'EACCES', 'mkdir', path);
  }
  await r.mount.mkdir(r.rel, path, !!options?.recursive);
  return undefined;
}

async function rename(from: string, to: string): Promise<void> {
  const a = at(from, 'rename');
  const b = at(to, 'rename');
  if (a.mount !== b.mount) throw fsError('EXDEV', 'rename', from);
  await a.mount.rename(a.rel, b.rel, from, to);
}

async function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
  const r = vfs.resolve(path);
  if (!r || !r.mount.lookup(r.rel)) {
    if (options?.force) return;
    throw fsError('ENOENT', 'rm', path);
  }
  if (!r.rel) throw fsError('EACCES', 'rm', path);
  await r.mount.remove(r.rel, path, !!options?.recursive);
}

async function copyFile(from: string, to: string): Promise<void> {
  const a = at(from, 'copyfile');
  const data = await a.mount.read(a.rel, from);
  const b = at(to, 'copyfile');
  await b.mount.write(b.rel, to, data.slice(), 'w');
}

async function cp(from: string, to: string, options?: { recursive?: boolean; filter?: (src: string) => boolean }): Promise<void> {
  const s = await stat(from);
  if (options?.filter && !options.filter(from)) return;
  if (!s.isDirectory()) return copyFile(from, to);
  if (!options?.recursive) throw fsError('EISDIR', 'cp', from);
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) await cp(`${from}/${name}`, `${to}/${name}`, options);
}

async function realpath(path: string): Promise<string> {
  await stat(path);
  return path.replace(/\/+$/, '') || '/';
}

async function truncate(path: string, length = 0): Promise<void> {
  const { mount, rel } = at(path, 'open');
  const data = await mount.read(rel, path);
  await mount.write(rel, path, data.slice(0, length), 'w');
}

async function chmod(path: string): Promise<void> {
  await stat(path);
}

/** A file opened with open(): reads come from the file's contents; writes are collected and written on close. */
class FileHandle {
  private chunks: Uint8Array[] = [];
  private closed = false;
  private flushed = false;

  constructor(
    private readonly path: string,
    private readonly writing: boolean,
  ) {}

  async read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    const { mount, rel } = at(this.path, 'read');
    const bytes = (await mount.read(rel, this.path)).subarray(position, position + length);
    buffer.set(bytes, offset);
    return { bytesRead: bytes.length, buffer };
  }

  async write(data: Data): Promise<{ bytesWritten: number }> {
    const bytes = bytesOf(data);
    this.chunks.push(bytes.slice());
    return { bytesWritten: bytes.length };
  }

  async sync(): Promise<void> {
    await this.flush();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.writing || this.flushed) return;
    this.flushed = true;
    await writeFile(this.path, concat(this.chunks));
    this.chunks = [];
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

async function open(path: string, flags: 'r' | 'w' = 'r'): Promise<FileHandle> {
  if (flags === 'r') await access(path);
  else if (flags !== 'w') throw new Error(`open: flag "${flags}" is not supported here.`);
  return new FileHandle(path, flags === 'w');
}

export const promises = { readFile, writeFile, appendFile, stat, lstat, access, readdir, mkdir, rename, rm, cp, copyFile, realpath, truncate, chmod, open };

type Listener = (...args: unknown[]) => void;

/** A write stream that collects what is written and writes the file on end(). */
export function createWriteStream(path: string) {
  const chunks: Uint8Array[] = [];
  const listeners: Record<string, Listener[]> = {};
  const fire = (event: string, ...args: unknown[]) => (listeners[event] ?? []).forEach((l) => l(...args));
  let done = false;
  return {
    write(chunk: Data): boolean {
      chunks.push(bytesOf(chunk).slice());
      return true;
    },
    end(): void {
      if (done) return;
      done = true;
      writeFile(path, concat(chunks)).then(
        () => fire('finish'),
        (e) => fire('error', e),
      );
    },
    destroy(err?: Error): void {
      if (done) return;
      done = true;
      if (err) fire('error', err);
    },
    on(event: string, listener: Listener) {
      (listeners[event] ??= []).push(listener);
      return this;
    },
  };
}

export interface FSWatcher {
  close(): void;
  on(event: 'error', listener: Listener): FSWatcher;
}

/** Changes made elsewhere (in the cloud) to a folder and everything in it; this app's own writes are not reported. */
export function watch(root: string, _options: { recursive?: boolean }, listener: (event: string, filename: string) => void): FSWatcher {
  const off = vfs.watch(root, (rel) => listener('change', rel));
  const watcher: FSWatcher = {
    close: off,
    on: () => watcher,
  };
  return watcher;
}

export default { promises, createWriteStream, watch };
