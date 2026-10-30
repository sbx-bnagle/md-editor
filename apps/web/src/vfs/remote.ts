// The library, kept in Dropbox or Google Drive. The whole tree is in memory; files are downloaded
// when first read and kept in the browser (IndexedDB) for later visits and for working offline.
//
// Changes are made here at once and sent to the service in order from a queue that is saved in the
// browser, so a reload, a closed tab or a lost connection loses nothing: the queue picks up where it
// was. Uploads wait a moment so a burst of saves sends the file once. A file written and renamed in
// one go (the backend's safe-write pattern: a hidden temporary file renamed over the real one) is
// sent as an upload of the real file.
//
// Changes made elsewhere (the Mac, another device) are fetched every 30 seconds, when the page comes
// back into view, and when the network returns; paths with changes of this device's waiting to be
// sent are left to those changes. A file changed in both places is not overwritten (uploads say which
// version they were edited from): this device's version is saved as a copy beside it, and the user is told.

import { idbDelete, idbEntries, idbGet, idbKeys, idbPut } from './idb';
import { vfs } from './mounts';
import { AuthError, CursorReset, OfflineError, type Provider, type RemoteEntry } from './provider';
import { TreeMount, newDir, newFile, splitRel, type DirNode, type FileNode, type Node } from './tree';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'signed-out' | 'error';

export type Op =
  | { kind: 'upload'; path: string; data: Uint8Array; base: string | null }
  | { kind: 'mkdir'; path: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'remove'; path: string };

interface Queued {
  key: number;
  op: Op;
  readyAt: number;
  started: boolean;
}

interface Snapshot {
  cursor: string;
  provider?: unknown;
  /** Queue items up to this key are reflected in `entries`. */
  appliedThrough: number;
  entries: Array<{ path: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; rev: string; remote: boolean }>;
}

export interface RemoteEvents {
  status(status: SyncStatus, pending: number): void;
  notice(message: string, kind: 'info' | 'error'): void;
  /** Keeps a file that could not be uploaded where the user can find it; returns that place. */
  keepUnsent(name: string, data: Uint8Array): Promise<string>;
  /** Waits until the user has signed in again. */
  signedIn(): Promise<void>;
}

const UPLOAD_DELAY_MS = 1500;
const POLL_MS = 30_000;
const isTemp = (path: string) => /(^|\/)\.[^/]*\.tmp$/.test(path);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');
const baseName = (path: string) => path.split('/').pop() ?? path;
const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

const meta = (node: Node) => (node.meta ??= {}) as { remote?: boolean; rev?: string };

export class RemoteMount extends TreeMount {
  private queue: Queued[] = [];
  private pumping = false;
  private cursor = '';
  private appliedThrough = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling: Promise<void> | null = null;
  private stopped = false;
  private lastStatus: SyncStatus | null = null;

  constructor(
    mountPoint: string,
    readonly provider: Provider,
    /** Names this library's saved state in the browser (service and folder). */
    readonly id: string,
    private readonly events: RemoteEvents,
  ) {
    super(mountPoint);
  }

  // ---------- Start ----------

  async init(): Promise<void> {
    const saved = await idbEntries<{ id: string; op: Op }>('queue');
    const mine = saved.filter(([, v]) => v.id === this.id);
    const snapshot = await idbGet<Snapshot>('kv', `snapshot:${this.id}`);
    if (snapshot) {
      this.fromSnapshot(snapshot);
      for (const [key, v] of mine) if (Number(key) > snapshot.appliedThrough) this.applyLocally(v.op);
    } else {
      // No saved tree: list the folder (this needs the network), then put this device's waiting changes on top.
      await this.relist(mine.map(([, v]) => v.op));
    }
    // Edits waiting to be uploaded are the newest contents of their files.
    for (const [, v] of mine) if (v.op.kind === 'upload') this.setData(v.op.path, v.op.data);
    this.queue = mine.map(([key, v]) => ({ key: Number(key), op: v.op, readyAt: 0, started: false }));
    this.appliedThrough = Math.max(this.appliedThrough, ...this.queue.map((q) => q.key));
    void this.pruneCache();
    this.saveSnapshotSoon();
    this.pump();
    if (snapshot) void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.poll();
  };

  private onOnline = () => {
    this.pump();
    void this.poll();
  };

  /** Lists the whole folder again and puts `pending` (changes not yet sent) on top. */
  private async relist(pending: Op[]): Promise<void> {
    const { entries, cursor } = await this.provider.list();
    this.root = newDir();
    for (const e of entries) this.putEntry(e);
    this.cursor = cursor;
    for (const op of pending) this.applyLocally(op);
  }

  private fromSnapshot(s: Snapshot): void {
    this.root = newDir();
    for (const e of s.entries) {
      const node = this.ensureParents(e.path);
      const name = baseName(e.path);
      if (e.kind === 'dir') {
        if (!node.children.has(name)) node.children.set(name, newDir(e.mtimeMs, { remote: e.remote }));
      } else node.children.set(name, newFile(null, e.size, e.mtimeMs, { remote: e.remote, rev: e.rev }));
    }
    this.cursor = s.cursor;
    this.appliedThrough = s.appliedThrough;
    if (s.provider !== undefined) this.provider.restoreState?.(s.provider);
  }

  // ---------- Tree edits that are not sent anywhere (from the service, or replayed) ----------

  private ensureParents(path: string): DirNode {
    let dir = this.root;
    for (const part of splitRel(parentPath(path))) {
      let next = dir.children.get(part);
      if (!next || next.kind !== 'dir') dir.children.set(part, (next = newDir(Date.now(), { remote: true })));
      dir = next as DirNode;
    }
    return dir;
  }

  private putEntry(e: RemoteEntry): void {
    if (!e.path) return;
    const dir = this.ensureParents(e.path);
    const name = baseName(e.path);
    const existing = dir.children.get(name);
    if (e.kind === 'dir') {
      if (existing?.kind === 'dir') meta(existing).remote = true;
      else dir.children.set(name, newDir(e.mtimeMs, { remote: true }));
      return;
    }
    if (existing?.kind === 'file' && meta(existing).rev === e.rev) {
      meta(existing).remote = true;
      return;
    }
    if (existing?.kind === 'file') {
      existing.data = null;
      existing.size = e.size;
      existing.mtimeMs = e.mtimeMs;
      existing.meta = { remote: true, rev: e.rev };
    } else dir.children.set(name, newFile(null, e.size, e.mtimeMs, { remote: true, rev: e.rev }));
  }

  private dropPath(path: string): boolean {
    const dir = this.lookup(parentPath(path));
    return !!dir && dir.kind === 'dir' && dir.children.delete(baseName(path));
  }

  private setData(path: string, data: Uint8Array): void {
    const dir = this.ensureParents(path);
    const name = baseName(path);
    const existing = dir.children.get(name);
    if (existing?.kind === 'file') {
      existing.data = data;
      existing.size = data.length;
    } else dir.children.set(name, newFile(data, data.length, Date.now(), { remote: false }));
  }

  /** Makes a queued change to the tree again (after a reload), without queueing it. */
  private applyLocally(op: Op): void {
    if (op.kind === 'upload') this.setData(op.path, op.data);
    else if (op.kind === 'mkdir') {
      const dir = this.ensureParents(op.path);
      if (!dir.children.has(baseName(op.path))) dir.children.set(baseName(op.path), newDir(Date.now(), { remote: false }));
    } else if (op.kind === 'remove') this.dropPath(op.path);
    else {
      const node = this.lookup(op.from);
      if (!node) return;
      this.dropPath(op.from);
      this.ensureParents(op.to).children.set(baseName(op.to), node);
    }
  }

  // ---------- File contents ----------

  protected async load(rel: string, node: FileNode): Promise<Uint8Array> {
    const rev = meta(node).rev ?? '';
    const key = `${this.id}|${rev}|${rel}`;
    if (rev) {
      const cached = await idbGet<Uint8Array>('cache', key);
      if (cached) return cached;
    }
    const data = await this.provider.download(rel);
    if (rev) await idbPut('cache', data, key).catch(() => undefined);
    return data;
  }

  /** Forgets downloaded files that are no longer current. */
  private async pruneCache(): Promise<void> {
    const keep = new Set(this.walk().map(({ rel, node }) => `${this.id}|${meta(node).rev ?? ''}|${rel}`));
    for (const key of await idbKeys('cache').catch(() => [])) {
      const k = String(key);
      if (k.startsWith(`${this.id}|`) && !keep.has(k)) await idbDelete('cache', k).catch(() => undefined);
    }
  }

  // ---------- Local changes: queued for the service ----------

  private async enqueue(op: Op, delay = 0): Promise<void> {
    const key = Number(await idbPut('queue', { id: this.id, op }));
    this.queue.push({ key, op, readyAt: Date.now() + delay, started: false });
    this.appliedThrough = Math.max(this.appliedThrough, key);
    this.saveSnapshotSoon();
    this.pump();
  }

  private async dropQueued(item: Queued): Promise<void> {
    this.queue = this.queue.filter((q) => q !== item);
    await idbDelete('queue', item.key);
  }

  /** The last queued upload of `path`, if it has not started and nothing after it touches the path. */
  private pendingUpload(path: string): Queued | null {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (q.op.kind === 'upload' && q.op.path === path) return q.started ? null : q;
      const touches = q.op.kind === 'move' ? under(path, q.op.from) || under(path, q.op.to) : under(path, q.op.path) || under(q.op.path, path);
      if (touches) return null;
    }
    return null;
  }

  protected override async afterWrite(rel: string, node: FileNode): Promise<void> {
    const data = node.data!;
    const waiting = this.pendingUpload(rel);
    if (waiting && waiting.op.kind === 'upload') {
      // A newer version of a file waiting to go: send this one instead, a little later.
      waiting.op.data = data;
      waiting.readyAt = Date.now() + UPLOAD_DELAY_MS;
      await idbPut('queue', { id: this.id, op: waiting.op }, waiting.key);
      this.saveSnapshotSoon();
      return;
    }
    await this.enqueue({ kind: 'upload', path: rel, data, base: meta(node).remote ? (meta(node).rev ?? null) : null }, isTemp(rel) ? 60_000 : UPLOAD_DELAY_MS);
  }

  protected override async afterMkdir(rel: string, node: DirNode): Promise<void> {
    meta(node).remote = false;
    await this.enqueue({ kind: 'mkdir', path: rel });
  }

  protected override async afterRename(from: string, to: string, node: Node, replaced: Node | null): Promise<void> {
    const waiting = node.kind === 'file' ? this.pendingUpload(from) : null;
    if (waiting && waiting.op.kind === 'upload' && !meta(node).remote) {
      // Not sent yet (a temporary file renamed over the real one): send it as the file at `to`.
      await this.dropQueued(waiting);
      node.meta = { remote: replaced ? !!meta(replaced).remote : false, rev: replaced ? meta(replaced).rev : undefined };
      await this.enqueue({ kind: 'upload', path: to, data: waiting.op.data, base: replaced && meta(replaced).remote ? (meta(replaced).rev ?? null) : null }, UPLOAD_DELAY_MS);
      return;
    }
    if (!meta(node).remote && !this.queue.some((q) => q.op.kind !== 'move' && under(q.op.path, from))) {
      // Never sent and nothing queued for it: only the new place matters.
      if (node.kind === 'dir') await this.enqueue({ kind: 'mkdir', path: to });
      return;
    }
    if (replaced && meta(replaced).remote) await this.enqueue({ kind: 'remove', path: to });
    await this.enqueue({ kind: 'move', from, to });
  }

  protected override async afterRemove(rel: string, node: Node): Promise<void> {
    // Uploads waiting for files that are gone now are not needed.
    for (const q of [...this.queue]) if (!q.started && q.op.kind === 'upload' && under(q.op.path, rel)) await this.dropQueued(q);
    if (meta(node).remote || this.queue.some((q) => q.started && q.op.kind !== 'move' && under(q.op.path, rel))) await this.enqueue({ kind: 'remove', path: rel });
    else this.saveSnapshotSoon();
  }

  // ---------- Sending ----------

  get pending(): number {
    return this.queue.length;
  }

  /** Waits until everything queued has been sent (or could not be). */
  async flush(timeoutMs = 20_000): Promise<void> {
    for (const q of this.queue) q.readyAt = 0;
    this.pump();
    const end = Date.now() + timeoutMs;
    while (this.queue.length && Date.now() < end && this.lastStatus !== 'offline' && this.lastStatus !== 'signed-out') await sleep(100);
  }

  private setStatus(status: SyncStatus): void {
    this.lastStatus = status;
    this.events.status(status, this.queue.length);
  }

  private pump(): void {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    void (async () => {
      let backoff = 2000;
      try {
        while (this.queue.length && !this.stopped) {
          const item = this.queue[0];
          const wait = item.readyAt - Date.now();
          if (wait > 0) {
            this.setStatus('syncing');
            await sleep(Math.min(wait, 500));
            continue;
          }
          this.setStatus('syncing');
          item.started = true;
          try {
            await this.send(item.op);
            backoff = 2000;
          } catch (e) {
            item.started = false;
            if (e instanceof OfflineError) {
              this.setStatus('offline');
              await sleep(backoff);
              backoff = Math.min(backoff * 2, 60_000);
              continue;
            }
            if (e instanceof AuthError) {
              this.setStatus('signed-out');
              await this.events.signedIn();
              continue;
            }
            await this.giveUp(item.op, e);
          }
          this.queue = this.queue.filter((q) => q !== item);
          await idbDelete('queue', item.key).catch(() => undefined);
        }
        if (!this.stopped) this.setStatus('synced');
      } finally {
        this.pumping = false;
      }
    })();
  }

  private async send(op: Op): Promise<void> {
    if (op.kind === 'mkdir') {
      await this.provider.mkdir(op.path);
      const node = this.lookup(op.path);
      if (node) meta(node).remote = true;
    } else if (op.kind === 'remove') await this.provider.remove(op.path);
    else if (op.kind === 'move') {
      await this.provider.move(op.from, op.to);
      const node = this.lookup(op.to);
      if (node) meta(node).remote = true;
    } else {
      const r = await this.provider.upload(op.path, op.data, op.base);
      if (r.conflict) await this.conflicted(op, r.entry);
      else {
        // Later uploads of this file were edited from this version now.
        for (const q of this.queue) if (q.op.kind === 'upload' && q.op.path === op.path && q.op !== op) q.op.base = r.entry.rev;
        const node = this.lookup(op.path);
        if (node?.kind === 'file') {
          node.meta = { remote: true, rev: r.entry.rev };
          if (node.data === op.data) await idbPut('cache', op.data, `${this.id}|${r.entry.rev}|${op.path}`).catch(() => undefined);
        }
      }
    }
    this.saveSnapshotSoon();
  }

  /** The file had changed elsewhere: this device's version went to a copy; the file shows the other version. */
  private async conflicted(op: Extract<Op, { kind: 'upload' }>, copy: RemoteEntry): Promise<void> {
    this.putEntry(copy);
    const copyNode = this.lookup(copy.path);
    if (copyNode?.kind === 'file') copyNode.data = op.data;
    const node = this.lookup(op.path);
    if (node?.kind === 'file' && node.data === op.data) {
      node.data = null;
      node.meta = { remote: true, rev: '' };
    }
    for (const q of this.queue) if (q.op.kind === 'upload' && q.op.path === op.path && q.op !== op) q.op.base = null;
    this.events.notice(`“${baseName(op.path)}” was changed in ${this.provider.label} while it was being edited here. This device's version is saved beside it as “${baseName(copy.path)}”.`, 'info');
    vfs.notify(`${this.mountPoint}/${op.path}`);
    vfs.notify(`${this.mountPoint}/${copy.path}`);
    // Find out the file's current version straight away.
    setTimeout(() => void this.poll(true), 0);
  }

  private async giveUp(op: Op, e: unknown): Promise<void> {
    const reason = e instanceof Error ? e.message : String(e);
    if (op.kind === 'upload' && !isTemp(op.path)) {
      const where = await this.events.keepUnsent(baseName(op.path), op.data).catch(() => null);
      this.events.notice(`“${op.path}” could not be saved to ${this.provider.label} (${reason}).${where ? ` This device's version is kept in ${where}.` : ''}`, 'error');
    } else if (!isTemp(op.kind === 'move' ? op.from : op.path)) {
      this.events.notice(`A change to “${op.kind === 'move' ? op.from : op.path}” could not be made in ${this.provider.label}: ${reason}`, 'error');
    }
    this.setStatus('error');
  }

  // ---------- Changes made elsewhere ----------

  /** Fetches changes made elsewhere. */
  poll(_force = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.polling ??= (async () => {
      try {
        let r: Awaited<ReturnType<Provider['changes']>>;
        try {
          r = await this.provider.changes(this.cursor);
        } catch (e) {
          if (!(e instanceof CursorReset)) throw e;
          await this.relist(this.queue.map((q) => q.op));
          for (const q of this.queue) if (q.op.kind === 'upload') this.setData(q.op.path, q.op.data);
          vfs.notify(this.mountPoint);
          this.saveSnapshotSoon();
          return;
        }
        const busy = (path: string) => this.queue.some((q) => (q.op.kind === 'move' ? under(path, q.op.from) || under(path, q.op.to) : under(path, q.op.path)));
        for (const c of r.changes) {
          if (!c.path || busy(c.path)) continue;
          const before = this.lookup(c.path);
          if (!c.entry) {
            if (this.dropPath(c.path)) vfs.notify(`${this.mountPoint}/${c.path}`);
            continue;
          }
          if (before?.kind === 'file' && c.entry.kind === 'file' && meta(before).rev === c.entry.rev) continue;
          if (before?.kind === 'dir' && c.entry.kind === 'dir') continue;
          if (before && before.kind !== c.entry.kind) this.dropPath(c.path);
          this.putEntry(c.entry);
          vfs.notify(`${this.mountPoint}/${c.path}`);
        }
        this.cursor = r.cursor;
        this.saveSnapshotSoon();
        if (this.lastStatus === 'offline' && !this.queue.length) this.setStatus('synced');
      } catch (e) {
        if (e instanceof OfflineError) this.setStatus('offline');
        else if (e instanceof AuthError) this.setStatus('signed-out');
        else console.error('Fetching changes failed', e);
      } finally {
        this.polling = null;
      }
    })();
    return this.polling;
  }

  // ---------- Saved tree ----------

  private saveSnapshotSoon(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => void this.saveSnapshot(), 800);
  }

  async saveSnapshot(): Promise<void> {
    this.snapshotTimer = null;
    const entries: Snapshot['entries'] = [];
    const visit = (dir: DirNode, prefix: string) => {
      for (const [name, node] of dir.children) {
        const path = prefix ? `${prefix}/${name}` : name;
        const m = meta(node);
        if (node.kind === 'dir') {
          entries.push({ path, kind: 'dir', size: 0, mtimeMs: node.mtimeMs, rev: '', remote: !!m.remote });
          visit(node, path);
        } else entries.push({ path, kind: 'file', size: node.size, mtimeMs: node.mtimeMs, rev: m.rev ?? '', remote: !!m.remote });
      }
    };
    visit(this.root, '');
    await idbPut('kv', { cursor: this.cursor, appliedThrough: this.appliedThrough, entries, provider: this.provider.saveState?.() } satisfies Snapshot, `snapshot:${this.id}`).catch(() => undefined);
  }
}
