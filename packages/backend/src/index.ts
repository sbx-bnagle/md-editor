import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { normalizePreferences, type AppApi, type AppState, type Preferences } from '@mde/core';
import { AiService } from './ai/service';
import { GuideService } from './guides';
import { DocumentService } from './documents';
import { ExportService } from './exporter';
import { readJson, writeJson } from './fsutil';
import { HistoryService, type HistoryOptions } from './history';
import type { HostAdapter } from './host';
import { LibraryService, UserError } from './library';
import { RenderService } from './render';
import { ThemeService } from './themes';
import { LibraryWatcher } from './watcher';

export { ASSET_SCHEME, assetUrlFor, pathFromAssetUrl } from './assets';
export type { HostAdapter } from './host';
export { UserError } from './library';

/** The part of AppApi implemented in Node. Spelling, dialogs, and events belong to the host. */
export type BackendApi = Omit<AppApi, 'spell' | 'ui' | 'events'>;

export interface BackendOptions {
  host: HostAdapter;
  settingsPath: string;
  /** Folder whose Collections/Templates/Themes subfolders seed a new library. */
  seedDir: string;
  version: string;
  platform: string;
  /** Overrides the saved library path (tests). */
  libraryPath?: string;
  history?: HistoryOptions;
}

interface Settings {
  libraryPath?: string;
  lastDocument?: string | null;
  prefs?: Partial<Preferences>;
}

export interface Backend {
  api: BackendApi;
  /** Absolute roots the asset protocol may serve from. */
  allowedRoots(): string[];
  dispose(): Promise<void>;
}

export async function createBackend(opts: BackendOptions): Promise<Backend> {
  const { host } = opts;
  let settings = await readJson<Settings>(opts.settingsPath, {});
  const saveSettings = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    return writeJson(opts.settingsPath, settings);
  };

  // eslint-disable-next-line prefer-const
  let themes: ThemeService;
  const library = new LibraryService(host, opts.seedDir, () => themes);
  themes = new ThemeService(library, host);
  const history = new HistoryService(library, host, opts.history);
  const documents = new DocumentService(library, themes, host);
  const render = new RenderService(library, themes);
  const exporter = new ExportService(library, render, history, documents, host);
  const osUser = (() => {
    try {
      return userInfo().username;
    } catch {
      return '';
    }
  })();
  const prefs = () => normalizePreferences(settings.prefs, osUser);
  const ai = new AiService(host, library, prefs);
  const guides = new GuideService(library, host);
  const watcher = new LibraryWatcher({
    changed(paths) {
      const projects = new Set<string>();
      let structural = false;
      for (const p of paths) {
        const project = library.root ? library.projectFor(p) : null;
        if (project) projects.add(project);
        structural = true;
      }
      for (const p of projects) history.touched(p);
      host.emit({ type: 'files-changed', paths });
      if (structural) host.emit({ type: 'library-changed' });
    },
  });

  const state = (): AppState => ({
    libraryPath: library.root,
    platform: opts.platform,
    version: opts.version,
    lastDocument: settings.lastDocument ?? null,
  });

  const initialLibrary = opts.libraryPath ?? settings.libraryPath;
  if (initialLibrary) {
    try {
      await library.open(initialLibrary, !!opts.libraryPath);
      watcher.start(initialLibrary);
    } catch {
      library.root = null;
    }
  }

  const api: BackendApi = {
    app: {
      state: async () => state(),
      defaultLibraryPath: async () => join(homedir(), 'Documents', 'MD Editor Library'),
      openLibrary: async (path, create) => {
        await history.flush();
        await library.open(path, create);
        watcher.start(path);
        await saveSettings({ libraryPath: path, lastDocument: null });
        return state();
      },
      chooseFolder: (title) => host.chooseFolder(title),
      setLastDocument: async (path) => {
        await saveSettings({ lastDocument: path });
      },
    },
    library: {
      tree: () => library.tree(),
      createCollection: (name) => library.createCollection(name),
      createProject: async (req) => {
        const p = await library.createProject(req);
        await history.snapshot(p, 'auto', 'Created', true);
        return p;
      },
      createTemplate: (req) => library.createTemplate(req),
      rename: (path, name) => library.rename(path, name),
      trash: (path) => library.trash(path),
      reveal: async (path) => host.reveal(library.assertInside(path)),
    },
    project: {
      details: (p) => documents.details(p),
      updateMeta: (p, patch) => documents.updateMeta(p, patch),
      projectFor: async (p) => library.projectFor(library.assertInside(p)),
      documents: (p) => documents.documents(p),
    },
    files: {
      readDocument: (p) => documents.readDocument(p),
      saveDocument: (req) => documents.saveDocument(req),
      readText: (p) => documents.readText(p),
      writeText: (p, t) => documents.writeText(p, t),
      createFile: (d, n, c) => documents.createFile(d, n, c),
      createFolder: (d, n) => documents.createFolder(d, n),
    },
    themes: {
      list: (p) => themes.list(p),
      create: (name, from) => themes.create(name, from),
      fork: (p, name) => themes.fork(p, name),
    },
    render: {
      document: (req) => render.render(req),
    },
    history: {
      list: (p) => history.list(p),
      checkpoint: (p, name) => history.checkpoint(p, name),
      changes: (p, id) => history.changes(p, id),
      diff: (p, id, path, against) => history.diff(p, id, path, against),
      restoreFile: (p, id, path) => history.restoreFile(p, id, path),
      restoreProject: (p, id) => history.restoreProject(p, id),
      touched: async (p) => history.touched(library.assertInside(p)),
    },
    exports: {
      pdf: (req) => exporter.pdf(req),
      zip: (req) => exporter.zip(req),
    },
    settings: {
      get: async () => prefs(),
      update: async (patch) => {
        const next = normalizePreferences({ ...prefs(), ...patch }, osUser);
        await saveSettings({ prefs: next });
        return next;
      },
    },
    ai: {
      keyStatus: () => ai.keyStatus(),
      setKey: (id, key) => ai.setKey(id, key),
      listModels: (id) => ai.listModels(id),
      test: (id) => ai.test(id),
      start: (req) => ai.start(req),
      cancel: (id) => ai.cancel(id),
      complete: (req) => ai.complete(req),
      logInsertion: (entry) => ai.logInsertion(entry),
      insertions: (p, limit) => ai.insertions(p, limit),
    },
    guides: {
      list: () => guides.list(),
      create: (kind, name, from) => guides.create(kind, name, from),
    },
  };

  return {
    api,
    allowedRoots: () => [library.root, opts.seedDir].filter((r): r is string => !!r),
    async dispose() {
      ai.cancelAll();
      watcher.stop();
      await history.flush();
    },
  };
}

export function isUserError(e: unknown): e is UserError {
  return typeof e === 'object' && e !== null && (e as { userFacing?: boolean }).userFacing === true;
}
