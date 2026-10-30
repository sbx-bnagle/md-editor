// The web app's host. Loaded before the UI (a classic script, so it runs first); it starts the
// backend in this page, on the web app's file system (vfs/), and gives the UI the same transport
// the Mac app's preload does (window.mdeHost).
//
// The library is kept in the user's Dropbox or Google Drive (storage/); settings stay in this
// browser; the AI keys are kept with the user's storage account.

import { createBackend, isUserError, setAssetPrefix, type Backend, type HostAdapter } from '@mde/backend';
import { commandForKey, type AppEvent, type ContextMenuItem, type MenuCommand, type SyncState } from '@mde/core';
import { assetPrefix, serveAssets } from './assets';
import { longPressMenus, menuAtSelection, showMenu, trackPointer } from './menu';
import { PRINT_CSS, printDocument, renderWebPage } from './print';
import { promises as fs } from './shims/fs';
import { setHomedir } from './shims/os';
import { DROPBOX, DropboxProvider, dropboxSignedIn, finishDropboxSignIn } from './storage/dropbox';
import { DRIVE, DriveProvider, driveSignedIn } from './storage/gdrive';
import { runSetup, saveConfig, savedConfig, signInAgain, type AppDefaults, type WebConfig } from './storage/setup';
import { addStyles } from './style';
import { idbGet } from './vfs/idb';
import { AppMount, LocalMount, vfs } from './vfs/mounts';
import type { Provider } from './vfs/provider';
import { RemoteMount, type SyncStatus } from './vfs/remote';
import './transport';

declare const __VERSION__: string;

type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();
const emit = (e: AppEvent) => {
  for (const l of listeners) l(e);
};

const APP = '/app';
const LOCAL = '/local';
const DOWNLOADS = `${LOCAL}/Downloads`;
const IMPORTS = `${LOCAL}/Imports`;

let config: WebConfig | null = savedConfig();
let defaults: AppDefaults = {};
let remote: RemoteMount | null = null;
let backend: Backend | null = null;
let sync: SyncState = { service: config?.kind === 'gdrive' ? 'Google Drive' : 'Dropbox', state: 'synced', pending: 0 };
const signInWaiters: Array<() => void> = [];

const libraryPoint = (c: WebConfig) => (c.kind === 'dropbox' ? `/Dropbox${c.root}` : `/Google Drive/${c.folderPath}`);

// ---------- Small helpers ----------

/** Gives the user a file from this browser's storage (a download), then forgets it here. */
async function download(path: string, remove = true): Promise<void> {
  const bytes = await fs.readFile(path);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = Object.assign(document.createElement('a'), { href: url, download: path.split('/').pop() ?? 'download' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (remove) await fs.rm(path, { force: true });
}

/** Lets the user pick files (a button in a small dialog: browsers open file pickers only from a click). */
function pickFiles(title: string, extensions: string[]): Promise<File[]> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: extensions.map((e) => `.${e}`).join(','), hidden: true });
    const h = Object.assign(document.createElement('h2'), { textContent: title });
    const p = Object.assign(document.createElement('p'), { className: 'modal-message', textContent: extensions.length ? `Files of the kinds ${extensions.join(', ')}.` : 'Any files.' });
    const actions = Object.assign(document.createElement('div'), { className: 'modal-actions' });
    const done = (files: File[]) => {
      backdrop.remove();
      resolve(files);
    };
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'button', textContent: 'Cancel', onclick: () => done([]) });
    const choose = Object.assign(document.createElement('button'), { type: 'button', className: 'button primary', textContent: 'Choose Files…', onclick: () => input.click() });
    input.onchange = () => done([...(input.files ?? [])]);
    actions.append(cancel, choose);
    box.append(h, p, input, actions);
    backdrop.append(box);
    document.body.append(backdrop);
    choose.focus();
  });
}

/** Copies files the user gave (picked or dropped) into this browser's storage; returns their paths. */
async function storeFiles(files: File[]): Promise<string[]> {
  const dir = `${IMPORTS}/${crypto.randomUUID()}`;
  await fs.mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const f of files) {
    const path = `${dir}/${f.name.replace(/\//g, '-')}`;
    await fs.writeFile(path, new Uint8Array(await f.arrayBuffer()));
    out.push(path);
  }
  return out;
}

// ---------- AI keys, kept with the storage account ----------

let secretsCache: Record<string, string> | null = null;

async function secrets(): Promise<Record<string, string>> {
  if (secretsCache) return secretsCache;
  const text = await remote?.provider.readSecrets();
  secretsCache = text ? (JSON.parse(text) as Record<string, string>) : {};
  return secretsCache;
}

// ---------- The host the backend runs on ----------

const host: HostAdapter = {
  // The service's own trash (Dropbox: deleted files; Google Drive: Trash) keeps what is removed.
  trash: async (path) => {
    await fs.rm(path, { recursive: true, force: true });
  },
  reveal: (path) => {
    const root = remote?.mountPoint;
    if (!remote || !root || !(path === root || path.startsWith(`${root}/`))) return;
    const url = remote.provider.webUrl(path.slice(root.length + 1));
    if (url) window.open(url, '_blank', 'noopener');
  },
  renderPdf: async () => {
    throw new Error('PDFs are printed from the browser in the web app.');
  },
  renderWebPage: (input) => renderWebPage(input),
  // Exports are written to this browser's storage and then downloaded (see the exports handlers).
  chooseSavePath: async ({ defaultPath }) => `${DOWNLOADS}/${defaultPath.split('/').pop() ?? 'Export'}`,
  chooseFolder: async () => {
    await showStorage();
    return null;
  },
  chooseFiles: async (title, extensions) => storeFiles(await pickFiles(title, extensions ?? [])),
  readXattr: async () => null,
  writeXattr: async () => undefined,
  emit,
  fetch: (input, init) => fetch(input, init),
  secrets: {
    get: async (name) => {
      try {
        return (await secrets())[name] ?? null;
      } catch {
        return null;
      }
    },
    set: async (name, value) => {
      const all = { ...(await secrets()) };
      if (value) all[name] = value;
      else delete all[name];
      await remote!.provider.writeSecrets(JSON.stringify(all, null, 2));
      secretsCache = all;
    },
  },
};

/** Switches service, folder or account (the setup); the app starts again with the new library. */
async function showStorage(): Promise<void> {
  const next = await runSetup(defaults, config, true);
  if (!next) return;
  await remote?.flush().catch(() => undefined);
  saveConfig(next);
  location.reload();
}

const hostUi: Record<string, (...args: never[]) => Promise<unknown>> = {
  'ui.confirm': async (message: string, detail?: string) => window.confirm(detail ? `${message}\n\n${detail}` : message),
  'ui.showEmojiPanel': async () => false,
  'ui.showContextMenu': (items: ContextMenuItem[]) => showMenu(items),
  'ui.startDrag': async () => false,
  'spell.learn': async () => undefined,
  'sync.signIn': async () => {
    if (!config) return;
    await signInAgain(config, defaults);
    secretsCache = null;
    signInWaiters.splice(0).forEach((r) => r());
  },
  'sync.showStorage': () => showStorage(),
};

let handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

/** Export PDF: laid out here and printed with the browser's print dialog. */
async function exportPdf(req: { docPath: string; arrangement?: Array<{ kind: string }>; headingsFromH1?: boolean }): Promise<null> {
  const result = await backend!.api.render.document({ docPath: req.docPath });
  const extra = (req.arrangement ?? []).some((p) => p.kind === 'pdf') ? 'PDFs arranged before or after the document are not included when printing from the browser. ' : '';
  await printDocument({ html: result.html, css: result.css, title: result.title, lang: result.variables.lang || 'en' }, extra ? `${extra}Choose Save as PDF in the print dialog to keep a PDF.` : null);
  return null;
}

/** Runs an export that writes a file (web page, ZIP) and downloads it. */
const withDownload =
  (fn: (...args: unknown[]) => Promise<unknown>) =>
  async (...args: unknown[]) => {
    const r = (await fn(...args)) as { path: string } | null;
    if (r?.path.startsWith(`${DOWNLOADS}/`)) await download(r.path);
    return r;
  };

// ---------- Start ----------

function setSync(status: SyncStatus, pending: number): void {
  sync = { service: remote?.provider.label ?? sync.service, state: status, pending };
  emit({ type: 'sync-status', status: sync });
}

async function loadDefaults(): Promise<AppDefaults> {
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as AppDefaults) : {};
  } catch {
    return {};
  }
}

/** A message in place of the app (when it cannot start). */
function fatal(message: string, action?: { label: string; run: () => void }): void {
  const box = document.createElement('div');
  box.className = 'folio-fatal';
  box.append(Object.assign(document.createElement('h2'), { textContent: 'Folio Dome could not open the library' }), Object.assign(document.createElement('p'), { textContent: message }));
  if (action) box.append(Object.assign(document.createElement('button'), { type: 'button', className: 'button primary', textContent: action.label, onclick: action.run }));
  document.body.append(box);
}

/** Waits for a click on a button (sign-in pop-ups open only from a click). */
function askToSignIn(service: string): Promise<void> {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'modal-backdrop';
    box.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>Sign in to ${service}</h2><p class="modal-message">Folio Dome needs to sign in to ${service} to open the library.</p><div class="modal-actions"><button type="button" class="button primary">Sign In</button></div></div>`;
    const btn = box.querySelector('button')!;
    btn.onclick = async () => {
      try {
        await hostUi['sync.signIn']();
        box.remove();
        resolve();
      } catch (e) {
        btn.textContent = 'Try Again';
        box.querySelector('.modal-message')!.textContent = e instanceof Error ? e.message : String(e);
      }
    };
    document.body.append(box);
    btn.focus();
  });
}

const ready = (async () => {
  defaults = await loadDefaults();
  setHomedir(LOCAL);
  const app = new AppMount(APP, new URL('app/', location.href).href);
  const local = new LocalMount(LOCAL);
  await Promise.all([app.init(), local.init()]);
  vfs.add(app);
  vfs.add(local);
  await new Promise<void>((r) => (document.readyState === 'loading' ? addEventListener('DOMContentLoaded', () => r(), { once: true }) : r()));

  // Back from Dropbox's sign-in page.
  const returned = sessionStorage.getItem('folio.oauth.return');
  if (returned) {
    sessionStorage.removeItem('folio.oauth.return');
    await finishDropboxSignIn(new URLSearchParams(returned), defaults.dropboxEndpoints ?? DROPBOX).catch((e) => alert(`Dropbox sign-in failed: ${e instanceof Error ? e.message : e}`));
  }
  if (!config || (config.kind === 'dropbox' && !dropboxSignedIn())) {
    config = await runSetup(defaults, config, false);
    if (!config) throw new Error('No library was chosen.');
    saveConfig(config);
  }
  const c = config;
  const provider: Provider = c.kind === 'dropbox' ? new DropboxProvider(c.appKey, c.root, defaults.dropboxEndpoints ?? DROPBOX) : new DriveProvider(c.folderId, defaults.driveEndpoints ?? DRIVE);
  const point = libraryPoint(c);
  remote = new RemoteMount(point, provider, `${c.kind}:${c.kind === 'dropbox' ? c.root.toLowerCase() : c.folderId}`, {
    status: setSync,
    notice: (message, kind) => emit({ type: 'notice', message, kind }),
    keepUnsent: async (name, data) => {
      await fs.mkdir(DOWNLOADS, { recursive: true });
      await fs.writeFile(`${DOWNLOADS}/${name}`, data);
      await download(`${DOWNLOADS}/${name}`);
      return 'your downloads';
    },
    signedIn: () => new Promise<void>((resolve) => signInWaiters.push(resolve)),
  });
  // Google's sign-in lasts an hour: a new visit with no saved tree must sign in first to list the folder.
  if (c.kind === 'gdrive' && !driveSignedIn() && !(await hasSnapshot(remote))) await askToSignIn('Google Drive');
  await remote.init();
  vfs.add(remote);
  setAssetPrefix(assetPrefix());
  backend = await createBackend({
    host,
    settingsPath: `${LOCAL}/settings.json`,
    seedDir: `${APP}/seed`,
    thesaurusPath: `${APP}/thesaurus/en.thes`,
    version: __VERSION__,
    platform: 'web',
    libraryPath: point,
  });
  await serveAssets(() => [...backend!.allowedRoots(), APP, IMPORTS]).catch((e) => emit({ type: 'notice', message: `Images and fonts cannot be shown: ${e instanceof Error ? e.message : e}`, kind: 'error' }));
  const map = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  for (const [ns, obj] of Object.entries(backend.api)) {
    for (const [name, fn] of Object.entries(obj as object)) if (typeof fn === 'function') map.set(`${ns}.${name}`, fn as (...args: unknown[]) => Promise<unknown>);
  }
  for (const [name, fn] of Object.entries(hostUi)) map.set(name, fn as (...args: unknown[]) => Promise<unknown>);
  map.set('exports.pdf', exportPdf as (...args: unknown[]) => Promise<unknown>);
  for (const name of ['exports.html', 'exports.zip', 'themes.exportTheme']) map.set(name, withDownload(map.get(name)!));
  handlers = map;
  setSync('synced', remote.pending);
})();

async function hasSnapshot(m: RemoteMount): Promise<boolean> {
  return !!(await idbGet('kv', `snapshot:${m.id}`));
}

// Values cross between the UI and the backend as copies, as they do over the Mac app's IPC.
const copy = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

window.mdeHost = {
  invoke: async (method, args) => {
    try {
      await ready;
      const fn = handlers.get(method);
      if (!fn) return { ok: false, message: `Unknown method ${method}` };
      const value = await fn(...copy(Array.isArray(args) ? args : []));
      return { ok: true, value: copy(value) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!isUserError(e)) console.error(`[${method}]`, e);
      return { ok: false, message, userFacing: isUserError(e) };
    }
  },
  subscribe: (listener) => {
    const l: Listener = (e) => listener(copy(e));
    listeners.add(l);
    // The current sync state, for a UI that subscribes after it was sent.
    queueMicrotask(() => l({ type: 'sync-status', status: sync }));
    return () => listeners.delete(l);
  },
  platform: 'web',
  filesApp: config?.kind === 'gdrive' ? 'Google Drive' : 'Dropbox',
  assetPrefix: assetPrefix(),
  pathsForFiles: async (files) => storeFiles(files),
};

// ---------- Keyboard shortcuts, menus, and leaving the page ----------

// The Mac app's menu shortcuts (those the browser lets a page have).
window.addEventListener(
  'keydown',
  (e) => {
    const command = commandForKey(e);
    if (!command) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) emit({ type: 'menu', command: command as MenuCommand });
  },
  true,
);

(window as { __folioEditorMenu?: () => void }).__folioEditorMenu = menuAtSelection;
/** For tests and troubleshooting: fetch changes now, and what is waiting to be sent. */
(window as { __folioSync?: unknown }).__folioSync = {
  poll: () => remote?.poll(),
  pending: () => remote?.pending ?? 0,
  state: () => sync,
};

// Typing is saved, and the history recorded, when the page is hidden (a phone switching apps).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  void (window as { __mdeFlush?: () => Promise<void> }).__mdeFlush?.().catch(() => undefined);
  void backend?.flush().catch(() => undefined);
});

window.addEventListener('beforeunload', (e) => {
  // Waiting changes are kept in the browser and sent on the next visit; still, say so.
  if (remote?.pending) e.preventDefault();
});

addEventListener('DOMContentLoaded', () => {
  addStyles(PRINT_CSS);
  trackPointer();
  longPressMenus();
  ready.catch((e) => {
    console.error('Folio Dome could not start.', e);
    fatal(e instanceof Error ? e.message : String(e), { label: 'Choose Storage…', run: () => void showStorage() });
  });
});
