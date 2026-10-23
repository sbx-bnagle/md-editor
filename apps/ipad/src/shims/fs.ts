// node:fs for the backend in the web view. Every call goes to the Swift shell (FileOps.swift),
// which reads and writes with file coordination (iCloud Drive and other providers' folders) and
// refuses paths outside the app's own folders and the folders the user picked.
//
// Only what the backend uses is here: the promise API, open() for whole-file writes and ranged
// reads, createWriteStream (collected, then written), and watch (FilePresenter events).

import { fromBase64, native, nativeError, onNative, toBase64 } from '../native';
import { BufferLike, decode, type BufferEncoding } from './buffer';

type EntryType = 'file' | 'dir' | 'link' | 'other';

interface StatReply {
  type: EntryType;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  mode: number;
  ino: number;
  dev: number;
}

export class Stats {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
  readonly mode: number;
  readonly ino: number;
  readonly dev: number;
  private readonly type: EntryType;

  constructor(r: StatReply) {
    this.type = r.type;
    this.size = r.size;
    this.mtimeMs = r.mtimeMs;
    this.ctimeMs = r.ctimeMs;
    this.birthtimeMs = r.birthtimeMs;
    this.mode = r.mode;
    this.ino = r.ino;
    this.dev = r.dev;
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
    return this.type === 'file';
  }

  isDirectory(): boolean {
    return this.type === 'dir';
  }

  isSymbolicLink(): boolean {
    return this.type === 'link';
  }
}

export class Dirent {
  constructor(
    readonly name: string,
    private readonly type: EntryType,
  ) {}

  isFile(): boolean {
    return this.type === 'file';
  }

  isDirectory(): boolean {
    return this.type === 'dir';
  }

  isSymbolicLink(): boolean {
    return this.type === 'link';
  }
}

type Encodingish = BufferEncoding | null | undefined | { encoding?: BufferEncoding | null; flag?: string; mode?: number };
type Data = string | Uint8Array;

const encodingOf = (o: Encodingish): BufferEncoding | null => (typeof o === 'string' ? o : (o?.encoding ?? null));
const isUtf8 = (e: BufferEncoding | null) => e === 'utf8' || e === 'utf-8';

function payload(data: Data, encoding: BufferEncoding | null): { data: string; encoding: 'utf8' | 'base64' } {
  if (typeof data === 'string') {
    if (encoding && !isUtf8(encoding)) throw new Error(`Writing text as ${encoding} is not supported here.`);
    return { data, encoding: 'utf8' };
  }
  return { data: toBase64(data), encoding: 'base64' };
}

async function readFile(path: string): Promise<BufferLike>;
async function readFile(path: string, options: BufferEncoding | { encoding: BufferEncoding }): Promise<string>;
async function readFile(path: string, options?: Encodingish): Promise<BufferLike | string>;
async function readFile(path: string, options?: Encodingish): Promise<BufferLike | string> {
  const encoding = encodingOf(options);
  if (isUtf8(encoding)) return native<string>('fs.read', { path, encoding: 'utf8' });
  const bytes = BufferLike.fromBytes(fromBase64(await native<string>('fs.read', { path, encoding: 'base64' })));
  return encoding ? decode(bytes, encoding) : bytes;
}

async function writeFile(path: string, data: Data, options?: Encodingish): Promise<void> {
  const flag = typeof options === 'object' && options?.flag ? options.flag : 'w';
  await native('fs.write', { path, ...payload(data, encodingOf(options)), flag });
}

async function appendFile(path: string, data: Data, options?: Encodingish): Promise<void> {
  await native('fs.write', { path, ...payload(data, encodingOf(options)), flag: 'a' });
}

async function stat(path: string): Promise<Stats> {
  return new Stats(await native<StatReply>('fs.stat', { path, follow: true }));
}

async function lstat(path: string): Promise<Stats> {
  return new Stats(await native<StatReply>('fs.stat', { path, follow: false }));
}

async function access(path: string): Promise<void> {
  await native('fs.stat', { path, follow: true });
}

async function readdir(path: string): Promise<string[]>;
async function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
async function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
  const entries = await native<Array<{ name: string; type: EntryType }>>('fs.readdir', { path });
  return options?.withFileTypes ? entries.map((e) => new Dirent(e.name, e.type)) : entries.map((e) => e.name);
}

async function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined> {
  await native('fs.mkdir', { path, recursive: !!options?.recursive });
  return undefined;
}

async function rename(from: string, to: string): Promise<void> {
  await native('fs.rename', { from, to });
}

async function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
  await native('fs.rm', { path, recursive: !!options?.recursive, force: !!options?.force });
}

async function copyFile(from: string, to: string): Promise<void> {
  await native('fs.copy', { from, to });
}

async function realpath(path: string): Promise<string> {
  return native<string>('fs.realpath', { path });
}

async function truncate(path: string, length = 0): Promise<void> {
  await native('fs.truncate', { path, length });
}

async function chmod(path: string, mode: number): Promise<void> {
  await native('fs.chmod', { path, mode });
}

/** A file opened with open(): reads go to the file in ranges; writes are collected and written on close. */
class FileHandle {
  private chunks: Uint8Array[] = [];
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly writing: boolean,
  ) {}

  async read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    const bytes = fromBase64(await native<string>('fs.read', { path: this.path, encoding: 'base64', offset: position, length }));
    buffer.set(bytes.subarray(0, length), offset);
    return { bytesRead: Math.min(bytes.length, length), buffer };
  }

  async write(data: Data): Promise<{ bytesWritten: number }> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
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

  private flushed = false;

  private async flush(): Promise<void> {
    if (!this.writing || this.flushed) return;
    this.flushed = true;
    await writeFile(this.path, concat(this.chunks));
    this.chunks = [];
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function open(path: string, flags: 'r' | 'w' = 'r'): Promise<FileHandle> {
  if (flags === 'r') await access(path);
  else if (flags !== 'w') throw new Error(`open: flag "${flags}" is not supported here.`);
  return new FileHandle(path, flags === 'w');
}

export const promises = { readFile, writeFile, appendFile, stat, lstat, access, readdir, mkdir, rename, rm, copyFile, realpath, truncate, chmod, open };

type Listener = (...args: unknown[]) => void;

/** A write stream that collects what is written and writes the file on end(). */
export function createWriteStream(path: string) {
  const chunks: Uint8Array[] = [];
  const listeners: Record<string, Listener[]> = {};
  const fire = (event: string, ...args: unknown[]) => (listeners[event] ?? []).forEach((l) => l(...args));
  let done = false;
  return {
    write(chunk: Data): boolean {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk.slice());
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

let watchIds = 0;

/**
 * Change notices for a folder and everything in it. The shell registers an NSFilePresenter,
 * which hears about changes other apps and sync services make (not the app's own writes).
 */
export function watch(root: string, _options: { recursive?: boolean }, listener: (event: string, filename: string) => void): FSWatcher {
  const id = `w${++watchIds}`;
  const errorListeners: Listener[] = [];
  const off = onNative((e) => {
    if (e.type !== 'fs.change' || e.id !== id) return;
    for (const p of e.paths) listener('change', p);
  });
  native('fs.watch', { id, path: root }).catch((e) => errorListeners.forEach((l) => l(e)));
  const watcher: FSWatcher = {
    close() {
      off();
      native('fs.unwatch', { id }).catch(() => undefined);
    },
    on(_event, l) {
      errorListeners.push(l);
      return watcher;
    },
  };
  return watcher;
}

export { nativeError };

export default { promises, createWriteStream, watch };
