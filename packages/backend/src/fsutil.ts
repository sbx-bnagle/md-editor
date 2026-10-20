import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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

/** Writes via a temporary file and rename so readers (and sync clients) never see a partial file. */
export async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, path);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
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
