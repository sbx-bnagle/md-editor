// Google Drive, through the Drive API (v3) from the browser. The user creates an OAuth client of the
// "Web application" kind once and gives its client ID; signing in opens a Google window that returns
// an access token (one hour; then the user is asked to sign in again with one click).
//
// The library is a folder in Drive, read with the full "drive" permission, so files the Mac adds
// through Google Drive for desktop are seen too. The AI keys are kept in the app's hidden data folder
// (appDataFolder), outside the library. Drive keeps files by id and allows two items with the same
// name in a folder; this keeps an index of the library's ids by path and uses the first of such twins.

import { AuthError, CursorReset, OfflineError, type Provider, type RemoteEntry, type UploadResult } from '../vfs/provider';
import { popupSignIn, randomString, redirectUri, savedJson } from './oauth';

export interface DriveEndpoints {
  auth: string;
  api: string;
  upload: string;
}

export const DRIVE: DriveEndpoints = { auth: 'https://accounts.google.com', api: 'https://www.googleapis.com/drive/v3', upload: 'https://www.googleapis.com/upload/drive/v3' };

const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'folio.gdrive.token';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,modifiedTime,size,version,parents,trashed';
const SECRETS_NAME = 'ai-keys.json';

interface Token {
  access: string;
  expiresAt: number;
}

/** Opens Google's sign-in window (call from a click). */
export async function driveSignIn(clientId: string, endpoints: DriveEndpoints = DRIVE): Promise<void> {
  const state = randomString(16);
  const url = new URL('/o/oauth2/v2/auth', endpoints.auth);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPES, include_granted_scopes: 'true', state }).toString();
  const params = await popupSignIn(url.href, state);
  const access = params.get('access_token');
  if (!access) throw new Error('Google did not return a sign-in.');
  savedJson.set(TOKEN_KEY, { access, expiresAt: Date.now() + Number(params.get('expires_in') ?? 3600) * 1000 } satisfies Token);
}

export function driveSignedIn(): boolean {
  const t = savedJson.get<Token>(TOKEN_KEY);
  return !!t && t.expiresAt > Date.now() + 30_000;
}

export function driveSignOut(): void {
  savedJson.set(TOKEN_KEY, null);
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  version?: string;
  parents?: string[];
  trashed?: boolean;
}

interface Indexed {
  id: string;
  name: string;
  parent: string;
  kind: 'file' | 'dir';
  size: number;
  mtimeMs: number;
  rev: string;
}

class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Google Drive: ${message}`);
  }
}

export class DriveProvider implements Provider {
  readonly label = 'Google Drive';
  private byId = new Map<string, Indexed>();

  /** `rootId` is the library folder's id. */
  constructor(
    readonly rootId: string,
    private readonly endpoints: DriveEndpoints = DRIVE,
  ) {}

  // ---------- Requests ----------

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const t = savedJson.get<Token>(TOKEN_KEY);
    if (!t || t.expiresAt < Date.now() + 30_000) throw new AuthError('Sign in to Google Drive again.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${t.access}`);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      throw new OfflineError(String(e));
    }
    if (res.status === 401) {
      savedJson.set(TOKEN_KEY, null);
      throw new AuthError('Sign in to Google Drive again.');
    }
    if (res.status === 429 || res.status >= 500) throw new OfflineError(`Google Drive is busy (${res.status}).`);
    if (res.status === 403) {
      const text = await res.text().catch(() => '');
      if (/rateLimit|userRateLimit/i.test(text)) throw new OfflineError('Google Drive asked to slow down.');
      throw new DriveError(403, text || 'not allowed');
    }
    if (!res.ok) throw new DriveError(res.status, (await res.text().catch(() => '')) || String(res.status));
    return res;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await (await this.call(url, init)).json()) as T;
  }

  private q(params: Record<string, string>): string {
    return new URLSearchParams(params).toString();
  }

  // ---------- Index: ids by path ----------

  private toIndexed(f: DriveFile, parent: string): Indexed {
    return { id: f.id, name: f.name, parent, kind: f.mimeType === FOLDER ? 'dir' : 'file', size: Number(f.size ?? 0), mtimeMs: Date.parse(f.modifiedTime ?? '') || Date.now(), rev: f.mimeType === FOLDER ? '' : (f.version ?? '') };
  }

  private pathOf(id: string): string | null {
    const parts: string[] = [];
    for (let cur = this.byId.get(id); cur; cur = this.byId.get(cur.parent)) {
      parts.unshift(cur.name);
      if (cur.parent === this.rootId) return parts.join('/');
    }
    return null;
  }

  private entryOf(item: Indexed): RemoteEntry | null {
    const path = this.pathOf(item.id);
    return path ? { path, kind: item.kind, size: item.size, mtimeMs: item.mtimeMs, rev: item.rev } : null;
  }

  private idOf(path: string): string | null {
    if (!path) return this.rootId;
    let parent = this.rootId;
    for (const name of path.split('/')) {
      let found: Indexed | undefined;
      for (const item of this.byId.values()) if (item.parent === parent && item.name === name && (!found || item.id < found.id)) found = item;
      if (!found) return null;
      parent = found.id;
    }
    return parent;
  }

  private need(path: string): string {
    const id = this.idOf(path);
    if (!id) throw new DriveError(404, `“${path}” was not found.`);
    return id;
  }

  /** Google Docs, Sheets and other Google formats have no file to edit; they are left out. */
  private usable(f: DriveFile): boolean {
    return f.mimeType === FOLDER || !f.mimeType.startsWith('application/vnd.google-apps.');
  }

  private async children(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken = '';
    do {
      const r = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(
        `${this.endpoints.api}/files?${this.q({ q: `'${folderId}' in parents and trashed = false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', spaces: 'drive', ...(pageToken ? { pageToken } : {}) })}`,
      );
      out.push(...r.files);
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  // ---------- Provider ----------

  async list(): Promise<{ entries: RemoteEntry[]; cursor: string }> {
    // The change cursor is taken first, so nothing changed during the listing is missed.
    const { startPageToken } = await this.json<{ startPageToken: string }>(`${this.endpoints.api}/changes/startPageToken`);
    this.byId.clear();
    const folders = [this.rootId];
    while (folders.length) {
      const id = folders.shift()!;
      for (const f of await this.children(id)) {
        if (!this.usable(f)) continue;
        const item = this.toIndexed(f, id);
        this.byId.set(f.id, item);
        if (item.kind === 'dir') folders.push(f.id);
      }
    }
    const entries = [...this.byId.values()].map((i) => this.entryOf(i)).filter((e): e is RemoteEntry => !!e);
    return { entries, cursor: startPageToken };
  }

  async changes(cursor: string): Promise<{ changes: Array<{ path: string; entry: RemoteEntry | null }>; cursor: string }> {
    const changes: Array<{ path: string; entry: RemoteEntry | null }> = [];
    let pageToken = cursor;
    let next = cursor;
    while (pageToken) {
      let r: { changes: Array<{ fileId: string; removed?: boolean; file?: DriveFile }>; nextPageToken?: string; newStartPageToken?: string };
      try {
        r = await this.json(`${this.endpoints.api}/changes?${this.q({ pageToken, fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))`, pageSize: '1000', spaces: 'drive', includeRemoved: 'true' })}`);
      } catch (e) {
        if (e instanceof DriveError && (e.status === 400 || e.status === 404)) throw new CursorReset(e.message);
        throw e;
      }
      for (const c of r.changes) {
        const known = this.byId.get(c.fileId);
        const oldPath = known ? this.pathOf(c.fileId) : null;
        const oldItems = known && known.kind === 'dir' ? this.descendants(c.fileId) : [];
        const f = c.file;
        const parent = f?.parents?.find((p) => p === this.rootId || this.byId.get(p)?.kind === 'dir');
        const inside = !!f && !c.removed && !f.trashed && !!parent && this.usable(f);
        if (known && oldPath) {
          // Gone, moved or renamed: the old paths go (and come back below at the new place).
          for (const d of oldItems) {
            const p = this.pathOf(d.id);
            if (p) changes.push({ path: p, entry: null });
          }
          if (!inside || parent !== known.parent || f!.name !== known.name) changes.push({ path: oldPath, entry: null });
        }
        if (!inside) {
          for (const d of oldItems) this.byId.delete(d.id);
          this.byId.delete(c.fileId);
          continue;
        }
        const item = this.toIndexed(f!, parent!);
        this.byId.set(f!.id, item);
        const entry = this.entryOf(item);
        if (entry) changes.push({ path: entry.path, entry });
        // A folder that moved in or within the library brings what it holds.
        for (const d of oldItems) {
          const e = this.entryOf(d);
          if (e) changes.push({ path: e.path, entry: e });
        }
        if (!known && item.kind === 'dir') {
          const stack = [item.id];
          while (stack.length) {
            const id = stack.pop()!;
            for (const child of await this.children(id)) {
              if (!this.usable(child)) continue;
              const ci = this.toIndexed(child, id);
              this.byId.set(child.id, ci);
              const ce = this.entryOf(ci);
              if (ce) changes.push({ path: ce.path, entry: ce });
              if (ci.kind === 'dir') stack.push(child.id);
            }
          }
        }
      }
      if (r.newStartPageToken) next = r.newStartPageToken;
      pageToken = r.nextPageToken ?? '';
    }
    return { changes, cursor: next };
  }

  private descendants(id: string): Indexed[] {
    const out: Indexed[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const item of this.byId.values()) {
        if (item.parent !== cur) continue;
        out.push(item);
        if (item.kind === 'dir') stack.push(item.id);
      }
    }
    return out;
  }

  async download(rel: string): Promise<Uint8Array> {
    const res = await this.call(`${this.endpoints.api}/files/${this.need(rel)}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async create(name: string, parent: string, data: Uint8Array | null, mimeType?: string): Promise<DriveFile> {
    const metadata = { name, parents: [parent], ...(mimeType ? { mimeType } : {}) };
    if (!data) return this.json<DriveFile>(`${this.endpoints.api}/files?${this.q({ fields: FIELDS })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
    const boundary = `folio${randomString(12)}`;
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + data.length + tail.length);
    body.set(head);
    body.set(data, head.length);
    body.set(tail, head.length + data.length);
    return this.json<DriveFile>(`${this.endpoints.upload}/files?${this.q({ uploadType: 'multipart', fields: FIELDS })}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as BodyInit });
  }

  async upload(rel: string, data: Uint8Array, base: string | null): Promise<UploadResult> {
    const parentPath = rel.split('/').slice(0, -1).join('/');
    const name = rel.split('/').pop()!;
    const parent = this.need(parentPath);
    const id = this.idOf(rel);
    if (id && base) {
      const current = await this.json<DriveFile>(`${this.endpoints.api}/files/${id}?${this.q({ fields: FIELDS })}`);
      if (!current.trashed && current.version !== base) {
        // Changed elsewhere since it was read here: this version goes beside it.
        const dot = name.lastIndexOf('.');
        const stamp = new Date().toISOString().slice(0, 10);
        const copyName = dot > 0 ? `${name.slice(0, dot)} (conflicted copy ${stamp})${name.slice(dot)}` : `${name} (conflicted copy ${stamp})`;
        const f = await this.create(copyName, parent, data);
        const item = this.toIndexed(f, parent);
        this.byId.set(f.id, item);
        return { entry: this.entryOf(item)!, conflict: true };
      }
    }
    const f = id
      ? await this.json<DriveFile>(`${this.endpoints.upload}/files/${id}?${this.q({ uploadType: 'media', fields: FIELDS })}`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: data as BodyInit })
      : await this.create(name, parent, data);
    const item = this.toIndexed(f, parent);
    this.byId.set(f.id, item);
    return { entry: this.entryOf(item)! };
  }

  async mkdir(rel: string): Promise<void> {
    if (!rel || this.idOf(rel)) return;
    const parent = this.need(rel.split('/').slice(0, -1).join('/'));
    const f = await this.create(rel.split('/').pop()!, parent, null, FOLDER);
    this.byId.set(f.id, this.toIndexed(f, parent));
  }

  async move(from: string, to: string): Promise<void> {
    const id = this.idOf(from);
    if (!id) return;
    const item = this.byId.get(id)!;
    const parent = this.need(to.split('/').slice(0, -1).join('/'));
    const name = to.split('/').pop()!;
    const params: Record<string, string> = { fields: FIELDS };
    if (parent !== item.parent) Object.assign(params, { addParents: parent, removeParents: item.parent });
    await this.json(`${this.endpoints.api}/files/${id}?${this.q(params)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    this.byId.set(id, { ...item, parent, name });
  }

  async remove(rel: string): Promise<void> {
    const id = this.idOf(rel);
    if (!id || id === this.rootId) return;
    await this.json(`${this.endpoints.api}/files/${id}?${this.q({ fields: 'id' })}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    for (const d of this.descendants(id)) this.byId.delete(d.id);
    this.byId.delete(id);
  }

  private async secretsFile(): Promise<string | null> {
    const r = await this.json<{ files: DriveFile[] }>(`${this.endpoints.api}/files?${this.q({ spaces: 'appDataFolder', q: `name = '${SECRETS_NAME}'`, fields: 'files(id)' })}`);
    return r.files[0]?.id ?? null;
  }

  async readSecrets(): Promise<string | null> {
    const id = await this.secretsFile();
    if (!id) return null;
    return (await this.call(`${this.endpoints.api}/files/${id}?alt=media`)).text();
  }

  async writeSecrets(text: string): Promise<void> {
    const id = await this.secretsFile();
    const data = new TextEncoder().encode(text);
    if (id) await this.call(`${this.endpoints.upload}/files/${id}?${this.q({ uploadType: 'media' })}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: data as BodyInit });
    else await this.create(SECRETS_NAME, 'appDataFolder', data);
  }

  saveState(): unknown {
    return [...this.byId.values()];
  }

  restoreState(state: unknown): void {
    if (Array.isArray(state)) this.byId = new Map((state as Indexed[]).map((i) => [i.id, i]));
  }

  webUrl(rel: string): string | null {
    const id = this.idOf(rel);
    if (!id) return null;
    const item = this.byId.get(id);
    return !item || item.kind === 'dir' ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`;
  }

  /** Folders in a folder (for choosing the library folder): [id, name]. */
  async folders(parentId: string): Promise<Array<{ id: string; name: string }>> {
    const r = await this.children(parentId);
    return r.filter((f) => f.mimeType === FOLDER).map((f) => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  async createFolder(parentId: string, name: string): Promise<string> {
    return (await this.create(name, parentId, null, FOLDER)).id;
  }
}
