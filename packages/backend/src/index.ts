import { homedir, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { normalizePreferences, paths, type AppApi, type AppState, type OpenTabs, type Preferences } from '@mde/core';
import { AiService } from './ai/service';
import { GuideService } from './guides';
import { DocumentService } from './documents';
import { ExportService } from './exporter';
import { readJson, writeJson } from './fsutil';
import { HistoryService, type HistoryOptions } from './history';
import { ReferenceService } from './references';
import { ChatService } from './chats';
import { SearchService } from './search';
import { TagService } from './tags';
import { ThesaurusService } from './thesaurus';
import type { HostAdapter } from './host';
import { LibraryService, UserError } from './library';
import { RenderService } from './render';
import { ThemeService } from './themes';
import { LibraryWatcher } from './watcher';

export { ASSET_SCHEME, assetPrefix, assetUrlFor, pathFromAssetUrl, setAssetPrefix } from './assets';
export type { HostAdapter, PrintedPdf } from './host';
export { UserError } from './library';
export { resolvesInside } from './fsutil';

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
  /** Thesaurus data file (scripts/build-thesaurus.mjs); lookups return null without it. */
  thesaurusPath?: string;
  history?: HistoryOptions;
}

interface Settings {
  libraryPath?: string;
  lastDocument?: string | null;
  openTabs?: OpenTabs | null;
  prefs?: Partial<Preferences>;
}

export interface Backend {
  api: BackendApi;
  /** Absolute roots the asset protocol may serve from. */
  allowedRoots(): string[];
  /** Writes what is waiting to be written (history), for a host about to be suspended. */
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createBackend(opts: BackendOptions): Promise<Backend> {
  const { host } = opts;
  let settings = await readJson<Settings>(opts.settingsPath, {});
  // Writes go one at a time, each with the settings as they are when it starts, so the file ends with the latest.
  let settingsWrite: Promise<void> = Promise.resolve();
  const saveSettings = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    settingsWrite = settingsWrite.catch(() => undefined).then(() => writeJson(opts.settingsPath, settings));
    return settingsWrite;
  };

  // eslint-disable-next-line prefer-const
  let themes: ThemeService;
  const library = new LibraryService(host, opts.seedDir, () => themes);
  themes = new ThemeService(library, host);
  const history = new HistoryService(library, host, opts.history);
  const thesaurus = new ThesaurusService(opts.thesaurusPath);
  thesaurus.warm(3000);
  const documents = new DocumentService(library, themes, host);
  const render = new RenderService(library, themes, join(opts.seedDir, 'Components'));
  const exporter = new ExportService(library, render, history, documents, host, () => [library.root, opts.seedDir].filter((r): r is string => !!r));
  const osUser = (() => {
    try {
      return userInfo().username;
    } catch {
      return '';
    }
  })();
  const prefs = () => normalizePreferences(settings.prefs, osUser);
  const references = new ReferenceService(library, documents);
  const chats = new ChatService(library);
  const search = new SearchService(library);
  const tags = new TagService(library, host);
  const ai = new AiService(host, library, prefs, references, documents);
  const guides = new GuideService(library, host);
  const watcher = new LibraryWatcher({
    changed(paths) {
      const projects = new Set<string>();
      let structural = false;
      for (const p of paths) {
        const project = library.root ? library.historyRootFor(p) : null;
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
    openTabs: settings.openTabs ?? null,
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
      defaultLibraryPath: async () => join(homedir(), 'Documents', 'Folio Dome Library'),
      openLibrary: async (path, create) => {
        await history.flush();
        await library.open(path, create);
        watcher.start(path);
        await saveSettings({ libraryPath: path, lastDocument: null, openTabs: null });
        return state();
      },
      chooseFolder: (title) => host.chooseFolder(title),
      chooseFiles: (title, extensions) => host.chooseFiles(title, extensions),
      setLastDocument: async (path) => {
        await saveSettings({ lastDocument: path });
      },
      setOpenTabs: async (tabs) => {
        const paths = Array.isArray(tabs?.paths) ? tabs.paths.filter((p): p is string | null => p === null || typeof p === 'string').slice(0, 100) : [];
        await saveSettings({ openTabs: paths.length ? { paths, active: Math.min(Math.max(0, Math.floor(Number(tabs.active) || 0)), paths.length - 1) } : null });
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
      search: (q) => search.search(q),
      reveal: async (path) => host.reveal(library.assertInside(path)),
    },
    project: {
      details: (p) => documents.details(p),
      updateMeta: (p, patch) => documents.updateMeta(p, patch),
      projectFor: async (p) => library.projectFor(library.assertInside(p)),
      documents: (p) => documents.documents(p),
      pdfs: (p) => documents.pdfs(p),
      importFiles: (p, sources, folder) => documents.importFiles(p, sources, folder),
    },
    files: {
      readDocument: (p) => documents.readDocument(p),
      saveDocument: (req) => documents.saveDocument(req),
      readText: (p) => documents.readText(p),
      writeText: (p, t) => documents.writeText(p, t),
      createFile: (d, n, c) => documents.createFile(d, n, c),
      createFolder: (d, n) => documents.createFolder(d, n),
      transfer: async (req) => {
        const from = paths.isInside(req.source, library.requireRoot()) ? library.projectFor(req.source) : null;
        const r = await documents.transfer(req);
        // Both projects' histories record the change.
        if ('path' in r) for (const p of new Set([from, library.projectFor(r.path)])) if (p) await history.touched(p);
        return r;
      },
    },
    themes: {
      list: (p) => themes.list(p),
      create: (name, from) => themes.create(name, from),
      fork: (p, name) => themes.fork(p, name),
      exportTheme: (name, out) => themes.exportTheme(name, out),
      importTheme: (source) => themes.importTheme(source),
      addFonts: (name, sources) => themes.addFonts(name, sources),
      addImages: (name, sources) => themes.addImages(name, sources),
      fontReport: (name) => themes.fontReport(name),
    },
    render: {
      document: (req) => render.render(req),
      components: (req) => render.components(req),
    },
    history: {
      list: (p) => history.list(p),
      checkpoint: (p, name) => history.checkpoint(p, name),
      changes: (p, id) => history.changes(p, id),
      diff: (p, id, path, against) => history.diff(p, id, path, against),
      restoreFile: (p, id, path) => history.restoreFile(p, id, path),
      restoreProject: (p, id) => history.restoreProject(p, id),
      touched: async (p) => history.touched(library.assertInside(p)),
      rootFor: async (p) => {
        const root = library.historyRootFor(library.assertInside(p));
        return root ? { path: root, name: basename(root), kind: library.projectFor(p) ? 'project' : 'library' } : null;
      },
    },
    exports: {
      pdf: (req) => exporter.pdf(req),
      zip: (req) => exporter.zip(req),
      html: (req) => exporter.html(req),
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
    chats: {
      load: (root) => chats.load(root),
      save: (root, turns) => chats.save(root, turns),
    },
    references: {
      list: (p) => references.list(p),
      setIncluded: (p, path, included) => references.setIncluded(p, path, included),
      add: (p, sources) => references.add(p, sources),
    },
    tags: {
      get: (paths) => tags.colors(paths),
      set: (path, color, on) => tags.set(path, color, on),
    },
    thesaurus: {
      lookup: (word, options) => thesaurus.lookup(word, options),
    },
  };

  return {
    api,
    allowedRoots: () => [library.root, opts.seedDir].filter((r): r is string => !!r),
    flush: () => history.flush(),
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
