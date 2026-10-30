// Dropbox, through its HTTP API (v2) from the browser. The user registers a Dropbox app once (its
// "app key" is all the web app needs; there is no secret) and signs in with PKCE. The access token
// lasts a few hours and is renewed with the refresh token.
//
// With an app of the "App folder" kind, paths start at Dropbox/Apps/<app name>; with "Full Dropbox",
// at the Dropbox folder. The AI keys are kept at /.folio-dome/ai-keys.json there, outside the library.

import { AuthError, CursorReset, OfflineError, type Provider, type RemoteEntry, type UploadResult } from '../vfs/provider';
import { pkceChallenge, randomString, redirectUri, savedJson } from './oauth';

export interface DropboxEndpoints {
  auth: string;
  api: string;
  content: string;
}

export const DROPBOX: DropboxEndpoints = { auth: 'https://www.dropbox.com', api: 'https://api.dropboxapi.com', content: 'https://content.dropboxapi.com' };

interface Tokens {
  access: string;
  expiresAt: number;
  refresh: string;
}

const TOKENS_KEY = 'folio.dropbox.tokens';
const PENDING_KEY = 'folio.dropbox.pending';
const SECRETS_PATH = '/.folio-dome/ai-keys.json';

/** Starts signing in: this page goes to Dropbox and comes back to oauth.html, which returns here. */
export async function startDropboxSignIn(appKey: string, endpoints: DropboxEndpoints = DROPBOX): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, appKey, back: location.href.split('#')[0] }));
  const url = new URL('/oauth2/authorize', endpoints.auth);
  url.search = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    token_access_type: 'offline',
    state,
  }).toString();
  location.assign(url.href);
}

/** Finishes signing in when Dropbox sent the user back with a code (oauth.html forwards it here). */
export async function finishDropboxSignIn(params: URLSearchParams, endpoints: DropboxEndpoints = DROPBOX): Promise<boolean> {
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as { verifier: string; state: string; appKey: string } | null;
  if (!pending || params.get('state') !== pending.state) return false;
  sessionStorage.removeItem(PENDING_KEY);
  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') || error);
  const res = await fetch(`${endpoints.api}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({ code: params.get('code') ?? '', grant_type: 'authorization_code', client_id: pending.appKey, redirect_uri: redirectUri(), code_verifier: pending.verifier }),
  });
  if (!res.ok) throw new Error(`Dropbox did not complete the sign-in (${res.status}).`);
  const t = (await res.json()) as { access_token: string; expires_in: number; refresh_token: string };
  savedJson.set(TOKENS_KEY, { access: t.access_token, expiresAt: Date.now() + t.expires_in * 1000, refresh: t.refresh_token } satisfies Tokens);
  return true;
}

export function dropboxSignedIn(): boolean {
  return !!savedJson.get<Tokens>(TOKENS_KEY)?.refresh;
}

export function dropboxSignOut(): void {
  savedJson.set(TOKENS_KEY, null);
}

/** Non-ASCII characters in the Dropbox-API-Arg header must be written as \\u escapes. */
const headerJson = (v: unknown) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

interface Meta {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_lower: string;
  path_display: string;
  rev?: string;
  size?: number;
  client_modified?: string;
  server_modified?: string;
}

class DropboxError extends Error {
  constructor(
    readonly summary: string,
    readonly error: Record<string, unknown> | undefined,
  ) {
    super(`Dropbox: ${summary}`);
  }
}

export class DropboxProvider implements Provider {
  readonly label = 'Dropbox';

  /** `root` is the library folder ("/Folio Dome Library"; "" for the top of an app folder). */
  constructor(
    private readonly appKey: string,
    readonly root: string,
    private readonly endpoints: DropboxEndpoints = DROPBOX,
  ) {}

  private full(rel: string): string {
    return rel ? `${this.root}/${rel}` : this.root;
  }

  private rel(meta: Meta): string | null {
    const lower = meta.path_lower;
    const rootLower = this.root.toLowerCase();
    if (lower === rootLower) return '';
    if (rootLower && !lower.startsWith(`${rootLower}/`)) return null;
    return meta.path_display.slice(this.root.length + 1);
  }

  private entry(meta: Meta): RemoteEntry | null {
    const path = this.rel(meta);
    if (path === null || meta['.tag'] === 'deleted') return null;
    if (meta['.tag'] === 'folder') return { path, kind: 'dir', size: 0, mtimeMs: 0, rev: '' };
    return { path, kind: 'file', size: meta.size ?? 0, mtimeMs: Date.parse(meta.client_modified ?? meta.server_modified ?? '') || Date.now(), rev: meta.rev ?? '' };
  }

  private async token(force = false): Promise<string> {
    const t = savedJson.get<Tokens>(TOKENS_KEY);
    if (!t?.refresh) throw new AuthError('Sign in to Dropbox.');
    if (!force && t.access && t.expiresAt > Date.now() + 60_000) return t.access;
    let res: Response;
    try {
      res = await fetch(`${this.endpoints.api}/oauth2/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.appKey }) });
    } catch (e) {
      throw new OfflineError(String(e));
    }
    if (res.status === 400 || res.status === 401) throw new AuthError('Sign in to Dropbox again.');
    if (!res.ok) throw new OfflineError(`Dropbox (${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    savedJson.set(TOKENS_KEY, { ...t, access: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }

  /** A request with the access token; renews it once when Dropbox says it expired. */
  private async call(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${await this.token(attempt > 0)}`);
      let res: Response;
      try {
        res = await fetch(url, { ...init, headers });
      } catch (e) {
        throw new OfflineError(String(e));
      }
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 401) throw new AuthError('Sign in to Dropbox again.');
      if (res.status === 429 || res.status >= 500) throw new OfflineError(`Dropbox is busy (${res.status}).`);
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error_summary?: string; error?: Record<string, unknown> };
        throw new DropboxError(body.error_summary ?? 'conflict', body.error);
      }
      if (!res.ok) throw new Error(`Dropbox: ${res.status} ${await res.text().catch(() => '')}`.trim());
      return res;
    }
  }

  private async rpc<T>(endpoint: string, body: unknown): Promise<T> {
    const res = await this.call(`${this.endpoints.api}/2/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as T;
  }

  private async listAll(first: { entries: Meta[]; cursor: string; has_more: boolean }): Promise<{ entries: Meta[]; cursor: string }> {
    const entries = [...first.entries];
    let page = first;
    while (page.has_more) {
      page = await this.rpc('files/list_folder/continue', { cursor: page.cursor });
      entries.push(...page.entries);
    }
    return { entries, cursor: page.cursor };
  }

  async list(): Promise<{ entries: RemoteEntry[]; cursor: string }> {
    let first: { entries: Meta[]; cursor: string; has_more: boolean };
    try {
      first = await this.rpc('files/list_folder', { path: this.root, recursive: true, include_deleted: false, limit: 2000 });
    } catch (e) {
      // A library folder that is not there yet is created by the backend (it seeds a new library).
      if (e instanceof DropboxError && /not_found/.test(e.summary)) {
        await this.mkdir('');
        first = await this.rpc('files/list_folder', { path: this.root, recursive: true, include_deleted: false, limit: 2000 });
      } else throw e;
    }
    const { entries, cursor } = await this.listAll(first);
    return { entries: entries.map((m) => this.entry(m)).filter((e): e is RemoteEntry => !!e && !!e.path), cursor };
  }

  async changes(cursor: string): Promise<{ changes: Array<{ path: string; entry: RemoteEntry | null }>; cursor: string }> {
    let first: { entries: Meta[]; cursor: string; has_more: boolean };
    try {
      first = await this.rpc('files/list_folder/continue', { cursor });
    } catch (e) {
      if (e instanceof DropboxError && /reset/.test(e.summary)) throw new CursorReset(e.summary);
      throw e;
    }
    const { entries, cursor: next } = await this.listAll(first);
    const changes: Array<{ path: string; entry: RemoteEntry | null }> = [];
    for (const m of entries) {
      const path = this.rel(m);
      if (path === null || path === '') continue;
      changes.push({ path, entry: m['.tag'] === 'deleted' ? null : this.entry(m) });
    }
    return { changes, cursor: next };
  }

  async download(rel: string): Promise<Uint8Array> {
    return this.downloadPath(this.full(rel));
  }

  private async downloadPath(path: string): Promise<Uint8Array> {
    const res = await this.call(`${this.endpoints.content}/2/files/download`, { method: 'POST', headers: { 'Dropbox-API-Arg': headerJson({ path }) } });
    return new Uint8Array(await res.arrayBuffer());
  }

  async upload(rel: string, data: Uint8Array, base: string | null): Promise<UploadResult> {
    const meta = await this.uploadPath(this.full(rel), data, base ? { '.tag': 'update', update: base } : 'add');
    const entry = this.entry(meta);
    if (!entry) throw new Error(`Dropbox saved “${rel}” outside the library.`);
    return { entry, conflict: entry.path.toLowerCase() !== rel.toLowerCase() };
  }

  private async uploadPath(path: string, data: Uint8Array, mode: unknown): Promise<Meta> {
    const res = await this.call(`${this.endpoints.content}/2/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson({ path, mode, autorename: true, mute: true, strict_conflict: false }) },
      body: data as BodyInit,
    });
    return (await res.json()) as Meta;
  }

  async mkdir(rel: string): Promise<void> {
    try {
      await this.rpc('files/create_folder_v2', { path: this.full(rel), autorename: false });
    } catch (e) {
      if (!(e instanceof DropboxError && /conflict/.test(e.summary))) throw e;
    }
  }

  async move(from: string, to: string): Promise<void> {
    try {
      await this.rpc('files/move_v2', { from_path: this.full(from), to_path: this.full(to), autorename: false });
    } catch (e) {
      if (!(e instanceof DropboxError && /from_lookup\/not_found/.test(e.summary))) throw e;
    }
  }

  async remove(rel: string): Promise<void> {
    try {
      await this.rpc('files/delete_v2', { path: this.full(rel) });
    } catch (e) {
      if (!(e instanceof DropboxError && /not_found/.test(e.summary))) throw e;
    }
  }

  async readSecrets(): Promise<string | null> {
    try {
      return new TextDecoder().decode(await this.downloadPath(SECRETS_PATH));
    } catch (e) {
      if (e instanceof DropboxError && /not_found/.test(e.summary)) return null;
      throw e;
    }
  }

  async writeSecrets(text: string): Promise<void> {
    await this.uploadPath(SECRETS_PATH, new TextEncoder().encode(text), 'overwrite');
  }

  webUrl(rel: string): string {
    return `https://www.dropbox.com/home${this.full(rel).split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Folders in `path` (for choosing the library folder). */
  async folders(path: string): Promise<string[]> {
    const { entries } = await this.listAll(await this.rpc('files/list_folder', { path, recursive: false, include_deleted: false, limit: 2000 }));
    return entries.filter((m) => m['.tag'] === 'folder').map((m) => m.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }
}
