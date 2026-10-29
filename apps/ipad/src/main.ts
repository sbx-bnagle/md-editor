// The iPad host. Loaded before the UI (a classic script, so it runs first); it starts the
// backend in this page and gives the UI the same transport the Mac app's preload does
// (window.mdeHost). Platform pieces come from the Swift shell through native().

import { createBackend, isUserError, type Backend, type HostAdapter, type PrintedPdf } from '@mde/backend';
import { APP_MENUS, commandForKey, type AppEvent, type ContextMenuItem, type MenuCommand } from '@mde/core';
import { keyToken, nativeFetch } from './http';
import { longPressMenus, menuAtSelection, showMenu, trackPointer } from './menu';
import { fromBase64, native, onNative, toBase64 } from './native';
import { promises as fs } from './shims/fs';
import { setHomedir } from './shims/os';
import { addStyles } from './style';
import { runSelfTest } from './selfTest';
import './transport';

interface AppInfo {
  /** The app's container (NSHomeDirectory); Documents is in it. */
  home: string;
  /** The bundled web folder (renderer, seed, thesaurus). */
  web: string;
  /** Application Support, for settings. */
  support: string;
  version: string;
  /** Folders the user picked before, where they are now (they can move, and the app's container does on reinstall). */
  folders: Array<{ path: string; previousPath: string }>;
  selfTest: boolean;
}

type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();
const emit = (e: AppEvent) => {
  for (const l of listeners) l(e);
};

const host: HostAdapter = {
  trash: (path) => native('files.trash', { path }),
  reveal: (path) => {
    native('files.reveal', { path }).catch((e) => console.error('Could not show the file in Files.', e));
  },
  renderPdf: async (input) => {
    const r = await native<{ pdf: string; inserts: PrintedPdf['inserts'] }>('print.pdf', input);
    return { pdf: fromBase64(r.pdf), inserts: r.inserts ?? [] };
  },
  renderWebPage: (input) => native<string>('print.web', input),
  chooseSavePath: ({ title, defaultPath, extensions }) => native<string | null>('dialog.save', { title, name: defaultPath.split('/').pop() ?? 'Untitled', extensions }),
  chooseFolder: (title) => native<string | null>('dialog.folder', { title }),
  chooseFiles: (title, extensions) => native<string[]>('dialog.files', { title, extensions: extensions ?? [] }),
  readXattr: async (path, name) => {
    const v = await native<string | null>('fs.xattr.get', { path, name });
    return v === null ? null : fromBase64(v);
  },
  writeXattr: async (path, name, value) => {
    await native('fs.xattr.set', { path, name, value: value ? toBase64(value) : null });
  },
  emit,
  fetch: nativeFetch,
  secrets: {
    // The key itself stays in the Keychain; requests carry a stand-in the shell replaces (see http.ts).
    get: async (name) => ((await native<boolean>('secrets.has', { name })) ? keyToken(name) : null),
    set: async (name, value) => {
      await native('secrets.set', { name, value });
    },
  },
};

const hostUi: Record<string, (...args: never[]) => Promise<unknown>> = {
  'ui.confirm': (message: string, detail?: string, okLabel = 'OK') => native<boolean>('dialog.confirm', { message, detail: detail ?? '', ok: okLabel }),
  // The on-screen keyboard has its own emoji keys; there is no picker to open from here.
  'ui.showEmojiPanel': async () => false,
  'ui.showContextMenu': (items: ContextMenuItem[]) => showMenu(items),
  // Dragging out to other apps needs the Files app's own drag; items move within the library only.
  'ui.startDrag': async () => false,
  'spell.learn': (word: string) => native('spell.learn', { word }),
};

let backend: Backend | null = null;
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

/** Paths saved in the settings follow the app's container and picked folders to where they are now. */
async function moveSavedPaths(settingsPath: string, info: AppInfo): Promise<void> {
  const hostFile = `${info.support}/ipad-host.json`;
  const saved = JSON.parse(await fs.readFile(hostFile, 'utf8').catch(() => '{}')) as { home?: string };
  const moves: Array<[string, string]> = info.folders.filter((f) => f.previousPath && f.previousPath !== f.path).map((f) => [f.previousPath, f.path]);
  if (saved.home && saved.home !== info.home) moves.push([saved.home, info.home]);
  if (moves.length) {
    const text = await fs.readFile(settingsPath, 'utf8').catch(() => null);
    if (text) {
      let settings = JSON.parse(text) as unknown;
      const move = (s: string) => {
        for (const [from, to] of moves) if (s === from || s.startsWith(`${from}/`)) return to + s.slice(from.length);
        return s;
      };
      const walk = (v: unknown): unknown => (typeof v === 'string' ? move(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
      settings = walk(settings);
      await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    }
  }
  if (saved.home !== info.home) {
    await fs.mkdir(info.support, { recursive: true });
    await fs.writeFile(hostFile, `${JSON.stringify({ home: info.home }, null, 2)}\n`);
  }
}

/** Tells the shell which folders the preview may load images and fonts from. */
function pushAssetRoots(): void {
  if (backend) native('assets.roots', { roots: backend.allowedRoots() }).catch(() => undefined);
}

const ready = (async () => {
  const info = await native<AppInfo>('app.info');
  setHomedir(info.home);
  const settingsPath = `${info.support}/settings.json`;
  await moveSavedPaths(settingsPath, info).catch((e) => console.error('Could not update saved paths.', e));
  backend = await createBackend({
    host,
    settingsPath,
    seedDir: `${info.web}/seed`,
    thesaurusPath: `${info.web}/thesaurus/en.thes`,
    version: info.version,
    platform: 'ios',
  });
  for (const [ns, obj] of Object.entries(backend.api)) {
    for (const [name, fn] of Object.entries(obj as object)) if (typeof fn === 'function') handlers.set(`${ns}.${name}`, fn as (...args: unknown[]) => Promise<unknown>);
  }
  for (const [name, fn] of Object.entries(hostUi)) handlers.set(name, fn as (...args: unknown[]) => Promise<unknown>);
  pushAssetRoots();
  native('menu.set', { menus: APP_MENUS }).catch(() => undefined);
  return info;
})();

// Values cross between the UI and the backend as copies, as they do over the Mac app's IPC, so
// neither side can change the other's objects.
const copy = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

window.mdeHost = {
  invoke: async (method, args) => {
    try {
      await ready;
      const fn = handlers.get(method);
      if (!fn) return { ok: false, message: `Unknown method ${method}` };
      const value = await fn(...copy(Array.isArray(args) ? args : []));
      if (method === 'app.openLibrary') pushAssetRoots();
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
    return () => listeners.delete(l);
  },
  spell: {
    check: (words) => native<string[]>('spell.check', { words }),
    suggest: (word) => native<string[]>('spell.suggest', { word }),
  },
  platform: 'ios',
};

// ---------- Keyboard shortcuts, menus, and the app's life cycle ----------

const runMenu = (command: MenuCommand) => emit({ type: 'menu', command });

// The Mac app's menu shortcuts. They are taken before the page sees them, as menu shortcuts are on the Mac.
window.addEventListener(
  'keydown',
  (e) => {
    const command = commandForKey(e);
    if (!command) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) runMenu(command);
  },
  true,
);

onNative(async (e) => {
  if (e.type === 'menu') runMenu(e.command as MenuCommand);
  else if (e.type === 'contextmenu') menuAtSelection();
  else if (e.type === 'app.active' && e.active) {
    // Files may have changed while the app was in the background (iCloud Drive, the Mac).
    emit({ type: 'library-changed' });
    const open = (window as { __mdeOpenPaths?: () => string[] }).__mdeOpenPaths?.() ?? [];
    if (open.length) emit({ type: 'files-changed', paths: open });
  }
});

/** Called by the shell when the app is about to be suspended: saves typing and history. */
(window as { __folioSuspend?: () => Promise<void> }).__folioSuspend = async () => {
  const flush = (window as { __mdeFlush?: () => Promise<void> }).__mdeFlush;
  await flush?.().catch(() => undefined);
  await backend?.flush().catch(() => undefined);
};

addEventListener('DOMContentLoaded', () => {
  addStyles();
  trackPointer();
  longPressMenus();
  ready
    .then((info) => runSelfTest(info))
    .catch((e) => {
      console.error('Folio Dome could not start.', e);
      document.body.insertAdjacentHTML('afterbegin', `<pre style="color:#ffaaa3;padding:24px;white-space:pre-wrap">Folio Dome could not start: ${String(e?.message ?? e).replace(/</g, '&lt;')}</pre>`);
    });
});
