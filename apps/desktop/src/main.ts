// Electron main process: wires the Node backend to the UI over IPC and supplies the
// platform pieces (windows, dialogs, Trash, PDF printing, spellcheck, menus).

import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, safeStorage, session, shell, type MenuItemConstructorOptions } from 'electron';
import { join, normalize, relative, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, promises as fsp } from 'node:fs';
import type { AppApi, AppEvent, ContextMenuItem } from '@mde/core';
import { ASSET_SCHEME, createBackend, isUserError, pathFromAssetUrl, type Backend, type HostAdapter, type PrintedPdf } from '@mde/backend';
import { buildMenu } from './menu';
import { createXattrs } from './xattr';
import { dotIcon } from './dotIcon';

const APP_SCHEME = 'app';
const DIST = __dirname;
const RENDERER_DIR = join(DIST, 'renderer');
const SEED_DIR = app.isPackaged ? join(process.resourcesPath, 'seed') : join(DIST, 'seed');
const THESAURUS_PATH = join(DIST, 'thesaurus', 'en.thes');

if (process.env.MDE_USER_DATA) app.setPath('userData', process.env.MDE_USER_DATA);
app.setName('MD Editor');

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let backend: Backend | null = null;

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.includes(`..${sep}`));
}

function registerProtocols(): void {
  protocol.handle(APP_SCHEME, async (req) => {
    const url = new URL(req.url);
    const path = normalize(join(RENDERER_DIR, decodeURIComponent(url.pathname)));
    if (url.host !== 'ui' || !isInside(path, RENDERER_DIR)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path).toString());
  });
  protocol.handle(ASSET_SCHEME, async (req) => {
    const path = pathFromAssetUrl(req.url);
    const roots = backend?.allowedRoots() ?? [];
    if (!path || !roots.some((r) => isInside(normalize(path), r)) || !existsSync(path)) {
      return new Response('Not found', { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(path).toString());
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'no-cache');
    return new Response(res.body, { status: res.status, headers });
  });
}

async function renderPdf(input: { html: string; css: string; title: string; lang: string }): Promise<PrintedPdf> {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  try {
    await win.loadURL(`${APP_SCHEME}://ui/print.html`);
    const layout = (await win.webContents.executeJavaScript(`window.__mdeRender(${JSON.stringify({ ...input, print: true })})`, true)) as { inserts?: PrintedPdf['inserts'] };
    const pdf = await win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      generateDocumentOutline: true,
      generateTaggedPDF: true,
    });
    return { pdf: new Uint8Array(pdf), inserts: layout?.inserts ?? [] };
  } finally {
    win.destroy();
  }
}

async function renderWebPage(input: { html: string; css: string; title: string; lang: string }): Promise<string> {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1200, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
  try {
    await win.loadURL(`${APP_SCHEME}://ui/print.html`);
    return (await win.webContents.executeJavaScript(`window.__mdeRenderWeb(${JSON.stringify(input)})`, true)) as string;
  } finally {
    win.destroy();
  }
}

function emit(event: AppEvent): void {
  mainWindow?.webContents.send('mde:event', event);
}

// API keys are encrypted with Electron safeStorage (a key held in the macOS Keychain)
// and stored in userData/secrets.json. They never reach the renderer.
const secretsFile = () => join(app.getPath('userData'), 'secrets.json');
async function readSecrets(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(secretsFile(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}
const secrets: HostAdapter['secrets'] = {
  async get(name) {
    const value = (await readSecrets())[name];
    if (!value) return null;
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      return null;
    }
  },
  async set(name, value) {
    const all = await readSecrets();
    if (value === null) delete all[name];
    else {
      if (!safeStorage.isEncryptionAvailable()) throw Object.assign(new Error('Secure storage is not available on this system.'), { userFacing: true });
      all[name] = safeStorage.encryptString(value).toString('base64');
    }
    await fsp.mkdir(app.getPath('userData'), { recursive: true });
    await fsp.writeFile(secretsFile(), JSON.stringify(all, null, 2), { mode: 0o600 });
  },
};

const xattrs = createXattrs(join(app.getPath('userData'), 'xattrs.json'));

const host: HostAdapter = {
  trash: (path) => shell.trashItem(path),
  readXattr: (path, name) => xattrs.read(path, name),
  writeXattr: (path, name, value) => xattrs.write(path, name, value),
  reveal: (path) => shell.showItemInFolder(path),
  renderPdf,
  renderWebPage,
  chooseSavePath: async ({ title, defaultPath, extensions }) => {
    const r = await dialog.showSaveDialog(mainWindow!, { title, defaultPath, filters: [{ name: extensions[0].toUpperCase(), extensions }] });
    return r.canceled || !r.filePath ? null : r.filePath;
  },
  chooseFolder: async (title) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  chooseFiles: async (title, extensions) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openFile', 'multiSelections'], filters: extensions?.length ? [{ name: 'Supported files', extensions }] : undefined });
    return r.canceled ? [] : r.filePaths;
  },
  emit,
  secrets,
};

type HostApi = Pick<AppApi, 'ui'> & { spell: Pick<AppApi['spell'], 'learn'> };

const hostApi: HostApi = {
  ui: {
    confirm: async (message, detail, okLabel = 'OK') => {
      const r = await dialog.showMessageBox(mainWindow!, { type: 'question', message, detail, buttons: [okLabel, 'Cancel'], defaultId: 0, cancelId: 1 });
      return r.response === 0;
    },
    showEmojiPanel: async () => {
      if (!app.isEmojiPanelSupported()) return false;
      app.showEmojiPanel();
      return true;
    },
    showContextMenu: (items: ContextMenuItem[]) =>
      new Promise((resolve) => {
        let chosen: string | null = null;
        const toTemplate = (list: ContextMenuItem[]): MenuItemConstructorOptions[] =>
          list.map((i) =>
            i.type === 'separator'
              ? { type: 'separator' }
              : i.role
                ? { role: i.role, label: i.label, enabled: i.enabled !== false }
                : i.submenu
                  ? { label: i.label, enabled: i.enabled !== false, submenu: toTemplate(i.submenu) }
                  : {
                      label: i.label,
                      enabled: i.enabled !== false,
                      ...(i.checked !== undefined ? { type: 'checkbox' as const, checked: i.checked } : {}),
                      ...(i.color ? { icon: dotIcon(i.color) } : {}),
                      click: () => (chosen = i.id ?? null),
                    },
          );
        Menu.buildFromTemplate(toTemplate(items)).popup({ window: mainWindow!, callback: () => setTimeout(() => resolve(chosen), 0) });
      }),
  },
  spell: {
    learn: async (word) => {
      session.defaultSession.addWordToSpellCheckerDictionary(word);
    },
  },
};

type Handler = (...args: unknown[]) => Promise<unknown>;
let handlers = new Map<string, Handler>();

function buildHandlers(api: object): Map<string, Handler> {
  const map = new Map<string, Handler>();
  const add = (ns: string, obj: object) => {
    for (const [name, fn] of Object.entries(obj)) if (typeof fn === 'function') map.set(`${ns}.${name}`, fn as Handler);
  };
  for (const [ns, obj] of Object.entries(api)) add(ns, obj as object);
  add('ui', hostApi.ui);
  add('spell', hostApi.spell);
  return map;
}

ipcMain.handle('mde:invoke', async (event, method: string, args: unknown[]) => {
  if (!event.senderFrame || !event.senderFrame.url.startsWith(`${APP_SCHEME}://ui/`)) return { ok: false, message: 'Forbidden' };
  const fn = handlers.get(method);
  if (!fn) return { ok: false, message: `Unknown method ${method}` };
  try {
    return { ok: true, value: await fn(...(Array.isArray(args) ? args : [])) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isUserError(e)) console.error(`[${method}]`, e);
    return { ok: false, message, userFacing: isUserError(e) };
  }
});

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'MD Editor',
    backgroundColor: '#1a1b1d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: join(DIST, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${APP_SCHEME}://ui/`)) e.preventDefault();
  });
  // The preview iframes too: a link in a document must not replace the preview.
  mainWindow.webContents.on('will-frame-navigate', (e) => {
    if (!e.url.startsWith(`${APP_SCHEME}://ui/`)) e.preventDefault();
  });
  mainWindow.on('closed', () => (mainWindow = null));
  await mainWindow.loadURL(`${APP_SCHEME}://ui/index.html`);
}

app.whenReady().then(async () => {
  registerProtocols();
  // Linux test machines have no keyring; tests opt in to obfuscated (not encrypted) storage.
  if (process.platform === 'linux' && process.env.MDE_TEST_PLAINTEXT_KEYS === '1') safeStorage.setUsePlainTextEncryption(true);
  if (process.platform !== 'darwin') session.defaultSession.setSpellCheckerLanguages(['en-US']);
  backend = await createBackend({
    host,
    settingsPath: join(app.getPath('userData'), 'settings.json'),
    seedDir: SEED_DIR,
    thesaurusPath: THESAURUS_PATH,
    version: app.getVersion(),
    platform: process.platform,
    libraryPath: process.env.MDE_LIBRARY,
    history: process.env.MDE_IDLE_MS ? { idleMs: Number(process.env.MDE_IDLE_MS) } : undefined,
  });
  handlers = buildHandlers(backend.api);
  Menu.setApplicationMenu(buildMenu((command) => emit({ type: 'menu', command }), !app.isPackaged || !!process.env.MDE_DEVTOOLS));
  await createWindow();
  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !backend) return;
  e.preventDefault();
  quitting = true;
  backend
    .dispose()
    .catch(() => undefined)
    .finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
