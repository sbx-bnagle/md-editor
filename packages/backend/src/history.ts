// Project version history. One append-only pack file per project (see core/history.ts).
// Snapshots are taken automatically after edits pause, before restores, on export, and
// on demand as named checkpoints.

import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  HISTORY_FILE,
  HISTORY_MAGIC,
  META_DIR,
  PROJECT_FILE,
  PROJECT_THEMES_DIR,
  compareSnapshots,
  computeDiff,
  decodeBlob,
  encodeBlobRecord,
  encodeSnapshotRecord,
  indexPack,
  isHiddenName,
  isImageFile,
  looksBinary,
  newSnapshotId,
  sameFiles,
  sha256Hex,
  type FileDiffResult,
  type PackIndex,
  type SnapshotChangeInfo,
  type SnapshotFile,
  type SnapshotInfo,
  type SnapshotKind,
  type SnapshotRecord,
} from '@mde/core';
import { atomicWrite, exists } from './fsutil';
import { UserError, type LibraryService } from './library';
import type { HostAdapter } from './host';

const decoder = new TextDecoder();

/** Hidden paths inside a project that are versioned (settings and theme forks). */
function includeHidden(rel: string): boolean {
  return rel === `${META_DIR}/${PROJECT_FILE}` || rel.startsWith(`${META_DIR}/${PROJECT_THEMES_DIR}/`);
}

async function walkProject(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (isHiddenName(e.name) && !(e.name === META_DIR && dir === root) && !includeHidden(rel)) continue;
    if (e.isDirectory()) await walkProject(root, abs, out);
    else if (e.isFile() && (!rel.startsWith(`${META_DIR}/`) || includeHidden(rel))) out.push(rel);
  }
  return out;
}

class ProjectHistory {
  private index: PackIndex | null = null;
  private hashCache = new Map<string, { size: number; mtimeMs: number; h: string }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly root: string) {}

  get file(): string {
    return join(this.root, META_DIR, HISTORY_FILE);
  }

  /** Serialises operations on this project's pack file. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async load(): Promise<PackIndex> {
    if (this.index) return this.index;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fs.readFile(this.file));
    } catch {
      bytes = new Uint8Array();
    }
    this.index = bytes.length ? indexPack(bytes) : { blobs: new Map(), snapshots: [], validLength: 0 };
    return this.index;
  }

  invalidate(): void {
    this.index = null;
  }

  async readBlob(hash: string): Promise<Uint8Array> {
    const index = await this.load();
    const loc = index.blobs.get(hash);
    if (!loc) throw new UserError('This version is missing from the history file.');
    const fh = await fs.open(this.file, 'r');
    try {
      const buf = new Uint8Array(loc.length);
      await fh.read(buf, 0, loc.length, loc.offset);
      return decodeBlob(buf);
    } finally {
      await fh.close();
    }
  }

  async currentFiles(): Promise<{ files: Record<string, SnapshotFile>; contents: Map<string, Uint8Array> }> {
    const files: Record<string, SnapshotFile> = {};
    const contents = new Map<string, Uint8Array>();
    for (const rel of await walkProject(this.root)) {
      const abs = join(this.root, rel);
      const st = await fs.stat(abs);
      const cached = this.hashCache.get(rel);
      if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
        files[rel] = { h: cached.h, s: st.size };
        continue;
      }
      const data = new Uint8Array(await fs.readFile(abs));
      const h = sha256Hex(data);
      this.hashCache.set(rel, { size: st.size, mtimeMs: st.mtimeMs, h });
      files[rel] = { h, s: data.length };
      contents.set(h, data);
    }
    return { files, contents };
  }

  async snapshot(kind: SnapshotKind, name: string | undefined, force: boolean): Promise<SnapshotRecord | null> {
    const index = await this.load();
    const { files, contents } = await this.currentFiles();
    const last = index.snapshots[index.snapshots.length - 1];
    if (!force && sameFiles(last?.files, files)) return null;

    const parts: Uint8Array[] = [];
    let size = 0;
    if (await exists(this.file)) {
      size = (await fs.stat(this.file)).size;
      if (index.validLength > 0 && index.validLength < size) {
        await fs.truncate(this.file, index.validLength);
        size = index.validLength;
      }
    }
    if (size === 0) parts.push(HISTORY_MAGIC);
    const added = new Set<string>();
    for (const [rel, f] of Object.entries(files)) {
      if (index.blobs.has(f.h) || added.has(f.h)) continue;
      const data = contents.get(f.h) ?? new Uint8Array(await fs.readFile(join(this.root, rel)));
      parts.push(encodeBlobRecord(f.h, data));
      added.add(f.h);
    }
    const time = Date.now();
    const record: SnapshotRecord = { id: newSnapshotId(time), time, kind, ...(name ? { name } : {}), ...(last ? { parent: last.id } : {}), files };
    parts.push(encodeSnapshotRecord(record));

    await fs.mkdir(dirname(this.file), { recursive: true });
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      buf.set(p, o);
      o += p.length;
    }
    await fs.appendFile(this.file, buf);
    this.invalidate();
    return record;
  }

  async snapshots(): Promise<SnapshotRecord[]> {
    return (await this.load()).snapshots;
  }

  async find(id: string): Promise<{ snap: SnapshotRecord; prev?: SnapshotRecord }> {
    const list = await this.snapshots();
    const i = list.findIndex((s) => s.id === id);
    if (i === -1) throw new UserError('Version not found.');
    return { snap: list[i], prev: list[i - 1] };
  }
}

export interface HistoryOptions {
  /** Milliseconds without changes before an automatic snapshot (default 2 minutes). */
  idleMs?: number;
}

export class HistoryService {
  private projects = new Map<string, ProjectHistory>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idleMs: number;

  constructor(
    private readonly library: LibraryService,
    private readonly host: HostAdapter,
    opts: HistoryOptions = {},
  ) {
    this.idleMs = opts.idleMs ?? 120_000;
  }

  private get(projectPath: string): ProjectHistory {
    this.library.assertInside(projectPath);
    let h = this.projects.get(projectPath);
    if (!h) {
      h = new ProjectHistory(projectPath);
      this.projects.set(projectPath, h);
    }
    return h;
  }

  private info(list: SnapshotRecord[], i: number): SnapshotInfo {
    const s = list[i];
    return {
      id: s.id,
      time: s.time,
      kind: s.kind,
      name: s.name,
      fileCount: Object.keys(s.files).length,
      changeCount: compareSnapshots(list[i - 1]?.files, s.files).length,
    };
  }

  async list(projectPath: string): Promise<SnapshotInfo[]> {
    const h = this.get(projectPath);
    return h.run(async () => {
      const list = await h.snapshots();
      return list.map((_, i) => this.info(list, i)).reverse();
    });
  }

  async snapshot(projectPath: string, kind: SnapshotKind, name?: string, force = false): Promise<SnapshotInfo | null> {
    const h = this.get(projectPath);
    this.clearTimer(projectPath);
    const rec = await h.run(() => h.snapshot(kind, name, force));
    if (!rec) return null;
    this.host.emit({ type: 'history-changed', projectPath });
    const list = await h.snapshots();
    return this.info(list, list.length - 1);
  }

  checkpoint(projectPath: string, name: string): Promise<SnapshotInfo | null> {
    return this.snapshot(projectPath, 'checkpoint', name.trim() || 'Checkpoint', true);
  }

  async changes(projectPath: string, id: string): Promise<SnapshotChangeInfo[]> {
    const h = this.get(projectPath);
    const { snap, prev } = await h.find(id);
    return compareSnapshots(prev?.files, snap.files).map((c) => ({ ...c, binary: isImageFile(c.path) }));
  }

  async diff(projectPath: string, id: string, path: string, against: 'previous' | 'current'): Promise<FileDiffResult> {
    const h = this.get(projectPath);
    const { snap, prev } = await h.find(id);
    const read = async (f: SnapshotFile | undefined) => (f ? h.readBlob(f.h) : null);
    let before: Uint8Array | null;
    let after: Uint8Array | null;
    if (against === 'previous') {
      before = await read(prev?.files[path]);
      after = await read(snap.files[path]);
    } else {
      before = await read(snap.files[path]);
      const abs = join(projectPath, path);
      after = (await exists(abs)) ? new Uint8Array(await fs.readFile(abs)) : null;
    }
    const binary = isImageFile(path) || (before !== null && looksBinary(before)) || (after !== null && looksBinary(after));
    const same = before !== null && after !== null && sha256Hex(before) === sha256Hex(after);
    if (binary) return { path, binary, hunks: [], same };
    return { path, binary, same, hunks: computeDiff(before ? decoder.decode(before) : '', after ? decoder.decode(after) : '') };
  }

  async restoreFile(projectPath: string, id: string, path: string): Promise<void> {
    const h = this.get(projectPath);
    const { snap } = await h.find(id);
    await this.snapshot(projectPath, 'auto', 'Before restore');
    const abs = join(projectPath, path);
    this.library.assertInside(abs);
    const f = snap.files[path];
    if (f) await atomicWrite(abs, await h.readBlob(f.h));
    else await fs.rm(abs, { force: true });
    await this.snapshot(projectPath, 'restore', `Restored ${path}`, true);
    this.host.emit({ type: 'files-changed', paths: [abs] });
  }

  async restoreProject(projectPath: string, id: string): Promise<void> {
    const h = this.get(projectPath);
    const { snap } = await h.find(id);
    await this.snapshot(projectPath, 'auto', 'Before restore');
    const { files: current } = await h.run(() => h.currentFiles());
    const changed: string[] = [];
    for (const [rel, f] of Object.entries(snap.files)) {
      if (current[rel]?.h === f.h) continue;
      const abs = join(projectPath, rel);
      await atomicWrite(abs, await h.readBlob(f.h));
      changed.push(abs);
    }
    for (const rel of Object.keys(current)) {
      if (snap.files[rel]) continue;
      const abs = join(projectPath, rel);
      await fs.rm(abs, { force: true });
      changed.push(abs);
    }
    const label = snap.name ?? new Date(snap.time).toLocaleString('en-US');
    await this.snapshot(projectPath, 'restore', `Restored “${label}”`, true);
    this.host.emit({ type: 'files-changed', paths: changed });
    this.host.emit({ type: 'library-changed' });
  }

  /** Records that a project changed; an automatic snapshot follows after the idle period. */
  touched(projectPath: string): void {
    this.clearTimer(projectPath);
    this.timers.set(
      projectPath,
      setTimeout(() => {
        this.timers.delete(projectPath);
        this.snapshot(projectPath, 'auto').catch(() => undefined);
      }, this.idleMs),
    );
  }

  private clearTimer(projectPath: string): void {
    const t = this.timers.get(projectPath);
    if (t) clearTimeout(t);
    this.timers.delete(projectPath);
  }

  /** Takes pending automatic snapshots now (on quit). */
  async flush(): Promise<void> {
    const pending = [...this.timers.keys()];
    for (const p of pending) {
      this.clearTimer(p);
      await this.snapshot(p, 'auto').catch(() => undefined);
    }
  }

  /** Drops cached indexes (e.g. after the pack file changed on another Mac). */
  invalidate(projectPath: string): void {
    this.projects.get(projectPath)?.invalidate();
  }
}
