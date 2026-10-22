import { promises as fs } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FINDER_TAGS_ATTR } from '@mde/core';
import type { HostAdapter } from './host';

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `p` exists and, with symbolic links followed, is inside one of `roots`. Paths are checked
 * as written before they reach here; this stops a link inside the library from reaching files
 * outside it.
 */
export async function resolvesInside(p: string, roots: string[]): Promise<boolean> {
  const real = await fs.realpath(p).catch(() => null);
  if (!real) return false;
  for (const r of roots) {
    const root = await fs.realpath(r).catch(() => r);
    if (real === root || real.startsWith(root.endsWith(sep) ? root : root + sep)) return true;
  }
  return false;
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Writes via a temporary file and rename so readers (and sync clients) never see a partial file.
 * A file that exists keeps its permissions, and a symbolic link stays a link (the file it points
 * to is replaced).
 */
export async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  const target = await fs.realpath(path).catch(() => path);
  const mode = (await fs.stat(target).catch(() => null))?.mode;
  await fs.mkdir(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmp, data);
  try {
    if (mode !== undefined) await fs.chmod(tmp, mode & 0o7777);
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/** atomicWrite for files the writer may have tagged in Finder: the tags (an extended attribute, lost with the old file) are put back. */
export async function replaceTaggedFile(host: Pick<HostAdapter, 'readXattr' | 'writeXattr'>, path: string, data: string | Uint8Array): Promise<void> {
  const tags = await host.readXattr(path, FINDER_TAGS_ATTR).catch(() => null);
  await atomicWrite(path, data);
  if (tags) await host.writeXattr(path, FINDER_TAGS_ATTR, tags).catch(() => undefined);
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Recursive copy. `skip` receives paths relative to `src`. */
export async function copyDir(src: string, dest: string, skip: (rel: string) => boolean = () => false, rel = ''): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (skip(r)) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, skip, r);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

/** Picks "Name", "Name 2", "Name 3", ... that does not exist in `dir`. */
export async function uniqueName(dir: string, name: string, ext = ''): Promise<string> {
  let candidate = `${name}${ext}`;
  for (let n = 2; await exists(join(dir, candidate)); n++) candidate = `${name} ${n}${ext}`;
  return candidate;
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
