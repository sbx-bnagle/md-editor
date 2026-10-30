// Mounts of the web app's file system, and the registry the fs stand-in uses to find them.
//
//   /app      the app's own files (seed library, components, thesaurus), fetched from the web server
//   /local    this browser's storage: settings, files being imported, exports being downloaded
//   /Dropbox/… or /Google Drive/…   the library (remote.ts)

import { idbDelete, idbEntries, idbPut } from './idb';
import { TreeMount, fsError, newDir, newFile, splitRel, type DirNode, type FileNode, type Node } from './tree';

type WatchListener = (absPath: string) => void;

class Registry {
  private mounts: TreeMount[] = [];
  private watchers = new Set<{ root: string; listener: WatchListener }>();

  add(mount: TreeMount): void {
    this.mounts = this.mounts.filter((m) => m.mountPoint !== mount.mountPoint);
    this.mounts.push(mount);
    this.mounts.sort((a, b) => b.mountPoint.length - a.mountPoint.length);
  }

  remove(mountPoint: string): void {
    this.mounts = this.mounts.filter((m) => m.mountPoint !== mountPoint);
  }

  /** The mount holding an absolute path, and the path inside it. */
  resolve(abs: string): { mount: TreeMount; rel: string } | null {
    const norm = abs.replace(/\/+$/, '') || '/';
    for (const mount of this.mounts) {
      if (norm === mount.mountPoint) return { mount, rel: '' };
      if (norm.startsWith(`${mount.mountPoint}/`)) return { mount, rel: norm.slice(mount.mountPoint.length + 1) };
    }
    return null;
  }

  /** Folders above the mounts ("/" and "/Google Drive"), which exist but hold only mounts. */
  virtualChildren(abs: string): string[] | null {
    const prefix = abs === '/' ? '/' : `${abs.replace(/\/+$/, '')}/`;
    const names = new Set<string>();
    for (const m of this.mounts) if (m.mountPoint.startsWith(prefix)) names.add(m.mountPoint.slice(prefix.length).split('/')[0]);
    return names.size || abs === '/' ? [...names] : null;
  }

  watch(root: string, listener: WatchListener): () => void {
    const w = { root: root.replace(/\/+$/, ''), listener };
    this.watchers.add(w);
    return () => this.watchers.delete(w);
  }

  /** Tells watchers a file or folder changed outside the app (in the cloud). */
  notify(abs: string): void {
    for (const w of this.watchers) if (abs === w.root || abs.startsWith(`${w.root}/`)) w.listener(abs.slice(w.root.length + 1));
  }
}

export const vfs = new Registry();

/** The app's own files, listed in app-files.json at build time and fetched when first read. */
export class AppMount extends TreeMount {
  override readonly readOnly = true;

  constructor(
    mountPoint: string,
    private readonly baseUrl: string,
  ) {
    super(mountPoint);
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.baseUrl}app-files.json`);
    if (!res.ok) throw new Error(`The app's file list could not be loaded (${res.status}).`);
    const list = (await res.json()) as { files: Array<{ path: string; size: number }> };
    for (const f of list.files) {
      const parts = splitRel(f.path);
      const name = parts.pop()!;
      let dir: DirNode = this.root;
      for (const p of parts) {
        let next = dir.children.get(p);
        if (!next) dir.children.set(p, (next = newDir(0)));
        dir = next as DirNode;
      }
      dir.children.set(name, newFile(null, f.size, 0));
    }
  }

  protected async load(rel: string): Promise<Uint8Array> {
    const res = await fetch(this.baseUrl + rel.split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) throw fsError('EIO', 'read', `${this.mountPoint}/${rel}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

interface LocalRecord {
  kind: 'file' | 'dir';
  data?: Uint8Array;
  mtimeMs: number;
}

/** This browser's own files (IndexedDB): settings, and files on their way in or out. */
export class LocalMount extends TreeMount {
  async init(): Promise<void> {
    const entries = await idbEntries<LocalRecord>('local');
    for (const [key, rec] of entries) {
      const parts = splitRel(String(key));
      const name = parts.pop();
      if (!name) continue;
      let dir: DirNode = this.root;
      for (const p of parts) {
        let next = dir.children.get(p);
        if (!next || next.kind !== 'dir') dir.children.set(p, (next = newDir()));
        dir = next as DirNode;
      }
      if (rec.kind === 'dir') {
        if (!dir.children.has(name)) dir.children.set(name, newDir(rec.mtimeMs));
      } else dir.children.set(name, newFile(rec.data ?? new Uint8Array(), rec.data?.length ?? 0, rec.mtimeMs));
    }
  }

  protected async load(_rel: string, node: FileNode): Promise<Uint8Array> {
    return node.data ?? new Uint8Array();
  }

  protected override async afterWrite(rel: string, node: FileNode): Promise<void> {
    await idbPut('local', { kind: 'file', data: node.data ?? undefined, mtimeMs: node.mtimeMs } satisfies LocalRecord, rel);
  }

  protected override async afterMkdir(rel: string, node: DirNode): Promise<void> {
    await idbPut('local', { kind: 'dir', mtimeMs: node.mtimeMs } satisfies LocalRecord, rel);
  }

  protected override async afterRename(from: string, to: string, node: Node, replaced: Node | null): Promise<void> {
    if (replaced) await this.forget(to, replaced);
    await this.forget(from, node);
    await this.save(to, node);
  }

  protected override async afterRemove(rel: string, node: Node): Promise<void> {
    await this.forget(rel, node);
  }

  private async save(rel: string, node: Node): Promise<void> {
    if (node.kind === 'file') return void (await idbPut('local', { kind: 'file', data: node.data ?? undefined, mtimeMs: node.mtimeMs } satisfies LocalRecord, rel));
    await idbPut('local', { kind: 'dir', mtimeMs: node.mtimeMs } satisfies LocalRecord, rel);
    for (const [name, child] of node.children) await this.save(`${rel}/${name}`, child);
  }

  private async forget(rel: string, node: Node): Promise<void> {
    await idbDelete('local', rel);
    if (node.kind === 'dir') for (const [name, child] of node.children) await this.forget(`${rel}/${name}`, child);
  }
}
