// UI behaviour that is not tied to one component. Talks to the host only through `api`.

import { paths, isImageFile, isMarkdownFile, type AppEvent, type DocumentFile, type ExportPart, type FileEntry, type GuideInfo, type MenuCommand, type ProjectDetails, type TagColor } from '@mde/core';
import { ApiError, FILES_APP, api, isIpad } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { runEditCommand } from '../editor/editCommands';
import { hasAiText } from '../editor/authorship';
import { openCommandBar, runReview } from '../ai/actions';
import { loadReferences, touchesReferences } from '../ai/references';
import { chatFilesChanged } from '../ai/chat';
import { refreshActiveGuides } from '../ai/context';
import { loadPrefs, updatePrefs } from './prefs';
import { previewPosition } from '../preview/sync';
import { getState, setState, toast, type DialogSpec, type OpenDoc, type OpenKind } from './store';

const TEXT_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.sh', '.html', '.xml', '.swift', '.rb', '.go', '.rs', '.sql', '.toml', '.ini']);

export function reportError(e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  toast(message, 'error');
  if (!(e instanceof ApiError && e.userFacing)) console.error(e);
}

export function kindFor(path: string): OpenKind {
  if (isMarkdownFile(path)) return 'markdown';
  const ext = paths.extname(path);
  if (ext === '.css') return 'css';
  if (isImageFile(path)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'unsupported';
}

let loadCounter = 0;

// ---------- Library ----------

export async function boot(): Promise<void> {
  // Called by the main process (webContents.executeJavaScript) before the window closes or the app quits.
  (window as unknown as { __mdeFlush?: () => Promise<void> }).__mdeFlush = flushBeforeClose;
  // The iPad host asks for these when the app returns to the foreground, to look for changes made meanwhile.
  (window as unknown as { __mdeOpenPaths?: () => string[] }).__mdeOpenPaths = () => getState().tabs.flatMap((t) => (t.path ? [t.path] : []));
  try {
    const app = await api.app.state();
    setState({ app });
    await loadPrefs().catch(reportError);
    if (app.libraryPath) {
      await loadTree();
      await restoreTabs(app).catch(() => undefined);
    }
  } catch (e) {
    reportError(e);
  } finally {
    setState({ booted: true });
  }
  api.events.subscribe(onEvent);
}

export async function openLibrary(path: string, create: boolean): Promise<void> {
  try {
    await closeDocument();
    const app = await api.app.openLibrary(path, create);
    editorBridge.forget();
    const tab = { id: ++tabCounter, path: null };
    setState({ app, tree: null, projects: {}, expanded: {}, doc: null, render: null, tabs: [tab], activeTab: tab.id, chats: {} });
    await loadTree();
  } catch (e) {
    reportError(e);
  }
}

export async function loadGuides(): Promise<void> {
  setState({ guides: await api.guides.list().catch(() => [] as GuideInfo[]) });
}

export async function loadTree(): Promise<void> {
  const tree = await api.library.tree();
  setState({ tree });
  loadTagColors(tree.collections.flatMap((c) => [c.path, ...c.projects.map((p) => p.path)]));
  await loadGuides();
  const { expanded, projects } = getState();
  const known = new Set([...tree.collections.flatMap((c) => c.projects.map((p) => p.path)), ...tree.templates.map((t) => t.path)]);
  const refreshed: Record<string, ProjectDetails> = {};
  for (const p of Object.keys(projects)) {
    if (known.has(p) && expanded[p]) refreshed[p] = await api.project.details(p).catch(() => projects[p]);
  }
  setState({ projects: refreshed });
}

let treeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTreeReload(): void {
  if (treeTimer) clearTimeout(treeTimer);
  treeTimer = setTimeout(() => {
    treeTimer = null;
    loadTree().catch(() => undefined);
  }, 250);
}

/** Loads Finder tag colours for library items (replacing what was known about them). */
async function loadTagColors(paths: string[]): Promise<void> {
  if (!paths.length || isIpad) return;
  const found = await api.tags.get(paths).catch(() => ({}) as Record<string, TagColor[]>);
  setState((s) => {
    const next = { ...s.tagColors };
    for (const p of paths) delete next[p];
    return { tagColors: { ...next, ...found } };
  });
}

function entryPaths(entries: FileEntry[], out: string[] = []): string[] {
  for (const e of entries) {
    out.push(e.path);
    if (e.children) entryPaths(e.children, out);
  }
  return out;
}

export async function setTagColor(path: string, color: TagColor, on: boolean): Promise<void> {
  try {
    const colors = await api.tags.set(path, color, on);
    setState((s) => {
      const next = { ...s.tagColors };
      if (colors.length) next[path] = colors;
      else delete next[path];
      return { tagColors: next };
    });
  } catch (e) {
    reportError(e);
  }
}

export async function loadProject(path: string): Promise<ProjectDetails | null> {
  try {
    const details = await api.project.details(path);
    setState((s) => ({ projects: { ...s.projects, [path]: details } }));
    loadTagColors(entryPaths(details.files));
    return details;
  } catch (e) {
    reportError(e);
    return null;
  }
}

export async function toggleExpanded(path: string, isProject: boolean): Promise<void> {
  const open = !getState().expanded[path];
  setState((s) => ({ expanded: { ...s.expanded, [path]: open } }));
  if (open && isProject) await loadProject(path);
}

async function expandTo(projectPath: string): Promise<void> {
  const collection = paths.dirname(projectPath);
  setState((s) => ({ expanded: { ...s.expanded, [collection]: true, [projectPath]: true } }));
  await loadProject(projectPath);
}

/** Project currently in context: the open document's, else the selected node's. */
export async function currentProject(): Promise<string | null> {
  const { doc, selected } = getState();
  if (doc?.projectPath) return doc.projectPath;
  if (selected) return api.project.projectFor(selected).catch(() => null);
  return null;
}

/** Folder whose history covers the open document or selected item (a project, Themes or Guides). */
export async function currentHistoryRoot(): Promise<{ path: string; name: string; kind: 'project' | 'library' } | null> {
  const { doc, selected } = getState();
  const p = doc?.path ?? selected;
  return p ? api.history.rootFor(p).catch(() => null) : null;
}

// ---------- Documents ----------

/**
 * Opens a file: in the current tab, or a new one with `newTab`. A file already open in a tab is
 * shown there instead of being opened twice.
 */
export function openFile(path: string, opts: { newTab?: boolean } = {}): Promise<void> {
  return queued(() => openFileNow(path, opts));
}

async function openFileNow(path: string, opts: { newTab?: boolean }): Promise<void> {
  const { tabs, activeTab } = getState();
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    if (existing.id !== activeTab) await switchTabNow(existing.id);
    return;
  }
  await leaveDocument();
  if (opts.newTab) {
    const tab = { id: ++tabCounter, path: null };
    setState((s) => ({ tabs: insertAfter(s.tabs, s.activeTab, tab), activeTab: tab.id }));
  } else editorBridge.forget(activeTab);
  await loadDocument(path);
}

/** Loads a file into the active tab. */
async function loadDocument(path: string): Promise<void> {
  const tabId = getState().activeTab;
  setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, path } : t)) }));
  persistTabs();
  const kind = kindFor(path);
  const projectPath = await api.project.projectFor(path).catch(() => null);
  const tree = getState().tree;
  const theme = tree?.themes.find((t) => t.cssPath === path);
  const base: Omit<OpenDoc, 'initialText' | 'mtimeMs' | 'annotations' | 'annotationStatus'> = {
    path,
    name: paths.basename(path),
    kind,
    projectPath,
    themeName: theme?.name ?? (kind === 'css' && path.includes('/.mdeditor/themes/') ? paths.basename(paths.dirname(path)) : undefined),
    loadId: ++loadCounter,
  };
  // Another tab was chosen while this one loaded.
  const stale = () => getState().activeTab !== tabId;
  try {
    if (kind === 'markdown') {
      const d = await api.files.readDocument(path);
      if (stale()) return;
      const resumed = editorBridge.resume(tabId, path, d.text, base.loadId);
      setState({
        doc: { ...base, initialText: d.text, mtimeMs: d.mtimeMs, annotations: d.annotations, annotationStatus: d.annotationStatus },
        dirty: false,
        previewDocPath: path,
        selected: path,
        pageCount: null,
        previewPage: null,
      });
      if (resumed === 'unsaved') markDirty();
      if (d.annotationStatus === 'invalid') {
        toast('Authorship annotations in this file do not match its text (it was edited elsewhere). They are kept but may be misplaced.', 'info');
      }
    } else if (kind === 'css' || kind === 'text') {
      const text = await api.files.readText(path);
      if (stale()) return;
      const resumed = editorBridge.resume(tabId, path, text, base.loadId);
      setState({ doc: { ...base, initialText: text, mtimeMs: Date.now(), annotations: null, annotationStatus: 'none' }, dirty: false, selected: path });
      if (resumed === 'unsaved') markDirty();
    } else {
      setState({ doc: { ...base, initialText: '', mtimeMs: 0, annotations: null, annotationStatus: 'none' }, dirty: false, selected: path, mode: 'edit' });
    }
    await api.app.setLastDocument(path).catch(() => undefined);
    if (getState().review && getState().review?.docPath !== path) setState({ review: null });
    refreshActiveGuides().catch(() => undefined);
    if (getState().references.projectPath !== projectPath) loadReferences(projectPath);
    if (getState().mode === 'preview') requestRender();
  } catch (e) {
    if (!stale()) setState({ doc: null, dirty: false, render: null });
    if (/ENOENT/.test(e instanceof Error ? e.message : String(e))) toast(`“${paths.basename(path)}” is no longer there. It may have been moved, renamed or deleted.`, 'error');
    else reportError(e);
  }
}

// ---------- Tabs ----------

let tabCounter = 1;

const insertAfter = <T extends { id: number }>(list: T[], id: number, item: T) => {
  const i = list.findIndex((t) => t.id === id);
  return [...list.slice(0, i + 1), item, ...list.slice(i + 1)];
};

/** Tab changes run one after another, each on the state the one before left. */
let tabQueue: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = tabQueue.catch(() => undefined).then(fn);
  tabQueue = run;
  return run;
}

/**
 * Saves the open document and keeps its editor (undo history, selection, scroll) for its tab.
 * Keys pressed from here on are meant for the next document, so the editor takes no more edits.
 * When the save fails the error is shown and the unsaved text is kept with the tab.
 */
async function leaveDocument(): Promise<void> {
  editorBridge.freeze();
  try {
    await saveNow();
  } catch (e) {
    reportError(e);
  }
  const { doc, activeTab, dirty } = getState();
  if (doc) editorBridge.keep(activeTab, doc.path, dirty);
}

function persistTabs(): void {
  const { tabs, activeTab } = getState();
  api.app.setOpenTabs({ paths: tabs.map((t) => t.path), active: Math.max(0, tabs.findIndex((t) => t.id === activeTab)) }).catch(() => undefined);
}

/** Shows a tab whose document is not loaded (the previous one is saved and kept, or closed). */
async function showTab(id: number): Promise<void> {
  const tab = getState().tabs.find((t) => t.id === id);
  if (!tab) return;
  setState({ activeTab: id });
  if (tab.path) await loadDocument(tab.path);
  else {
    setState({ doc: null, dirty: false, render: null, selected: null });
    persistTabs();
  }
}

export function switchTab(id: number): Promise<void> {
  return queued(() => switchTabNow(id));
}

async function switchTabNow(id: number): Promise<void> {
  if (id === getState().activeTab || !getState().tabs.some((t) => t.id === id)) return;
  await leaveDocument();
  await showTab(id);
}

/** Shows the next (1) or previous (-1) tab. */
export function cycleTab(step: 1 | -1): void {
  queued(async () => {
    const { tabs, activeTab } = getState();
    const i = tabs.findIndex((t) => t.id === activeTab);
    if (tabs.length > 1) await switchTabNow(tabs[(i + step + tabs.length) % tabs.length].id);
  }).catch(reportError);
}

/** An empty tab after the current one; the next file chosen in the library opens in it. */
export function newTab(): Promise<void> {
  return queued(async () => {
    await leaveDocument();
    const tab = { id: ++tabCounter, path: null };
    setState((s) => ({ tabs: insertAfter(s.tabs, s.activeTab, tab) }));
    await showTab(tab.id);
  });
}

/** Closes a tab (the active one by default). Closing the last tab leaves an empty one. */
export function closeTab(id?: number): Promise<void> {
  return queued(() => closeTabNow(id ?? getState().activeTab));
}

async function closeTabNow(id: number): Promise<void> {
  if (!getState().tabs.some((t) => t.id === id)) return;
  if (id === getState().activeTab) {
    try {
      await saveNow();
    } catch (e) {
      reportError(e);
      const name = getState().doc?.name ?? 'this document';
      if (!(await api.ui.confirm(`“${name}” could not be saved. Close it anyway?`, 'Changes made since it was last saved will be lost.', 'Close Without Saving'))) return;
    }
  }
  const { tabs, activeTab } = getState();
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  if (tabs.length === 1 && !tabs[0].path) return;
  editorBridge.forget(id);
  const rest = tabs.filter((t) => t.id !== id);
  if (id !== activeTab) {
    setState({ tabs: rest });
    persistTabs();
    return;
  }
  const next = rest[Math.min(i, rest.length - 1)] ?? { id: ++tabCounter, path: null };
  setState({ tabs: rest.length ? rest : [next] });
  await showTab(next.id);
}

/** Closes the tabs of files inside `path` (moved to the Trash). */
async function closeTabsInside(path: string): Promise<void> {
  const { tabs, activeTab, doc } = getState();
  const gone = tabs.filter((t) => t.path && paths.isInside(t.path, path));
  if (!gone.length) return;
  if (doc && paths.isInside(doc.path, path)) setState({ doc: null, dirty: false, render: null });
  for (const t of gone) editorBridge.forget(t.id);
  const rest = tabs.filter((t) => !gone.includes(t));
  if (!gone.some((t) => t.id === activeTab)) {
    setState({ tabs: rest });
    persistTabs();
    return;
  }
  const i = tabs.findIndex((t) => t.id === activeTab);
  const next = rest.filter((t) => tabs.indexOf(t) > i)[0] ?? rest[rest.length - 1] ?? { id: ++tabCounter, path: null };
  setState({ tabs: rest.length ? rest : [next] });
  await showTab(next.id);
}

/** Restores the tabs of the last session (or its last document). */
async function restoreTabs(app: { openTabs: { paths: Array<string | null>; active: number } | null; lastDocument: string | null }): Promise<void> {
  const saved = app.openTabs?.paths.length ? app.openTabs : app.lastDocument ? { paths: [app.lastDocument], active: 0 } : null;
  if (!saved) return;
  const tabs = saved.paths.map((path) => ({ id: ++tabCounter, path }));
  const active = tabs[Math.min(saved.active, tabs.length - 1)];
  setState({ tabs, activeTab: active.id });
  if (active.path) {
    const project = await api.project.projectFor(active.path).catch(() => null);
    if (project) await expandTo(project);
    await loadDocument(active.path);
  }
}

export async function closeDocument(): Promise<void> {
  await saveNow();
  setState({ doc: null, dirty: false, render: null });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<void> | null = null;
/** The text this window last wrote to each file, to tell its own saves from changes made elsewhere. */
const lastWritten = new Map<string, string>();

export function markDirty(): void {
  setState({ dirty: true });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow().catch(reportError);
  }, 800);
}

export async function saveNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (savePromise) await savePromise;
  const { doc, dirty } = getState();
  if (!doc || !dirty) return;
  const text = editorBridge.getText();
  if (text === null) return;
  savePromise = (async () => {
    setState({ saving: true });
    lastWritten.set(doc.path, text);
    try {
      if (doc.kind === 'markdown') {
        const all = editorBridge.getSpans();
        // Authorship is written only to files that already carry it or now contain AI text.
        const record = getState().prefs?.recordAuthorship !== false;
        const spans = doc.annotations || (record && hasAiText(all)) ? all : undefined;
        const r = await api.files.saveDocument({ path: doc.path, text, spans, annotations: doc.annotations });
        setState((s) => (s.doc?.path === doc.path ? { doc: { ...s.doc, mtimeMs: r.mtimeMs } } : {}));
      } else {
        await api.files.writeText(doc.path, text);
      }
      // Only clear the flag when nothing changed while saving.
      if (editorBridge.getText() === text && getState().doc?.path === doc.path) setState({ dirty: false, lastSaved: Date.now() });
      if (doc.projectPath) api.history.touched(doc.projectPath).catch(() => undefined);
      if (doc.kind === 'markdown') refreshActiveGuides().catch(() => undefined);
    } finally {
      setState({ saving: false });
      savePromise = null;
    }
  })();
  await savePromise;
}

async function reloadIfChanged(path: string): Promise<void> {
  const { doc } = getState();
  if (!doc || doc.path !== path || (doc.kind !== 'markdown' && doc.kind !== 'css' && doc.kind !== 'text')) return;
  let disk: { text: string; mtimeMs: number; annotations?: DocumentFile['annotations']; annotationStatus?: DocumentFile['annotationStatus'] };
  try {
    disk = doc.kind === 'markdown' ? await api.files.readDocument(path) : { text: await api.files.readText(path), mtimeMs: Date.now() };
  } catch {
    // File removed: keep the buffer; the next save recreates it.
    return;
  }
  // The document may have changed while the file was read (another tab, a reload).
  const now = getState();
  if (now.doc?.loadId !== doc.loadId) return;
  const buffer = editorBridge.getText();
  if (disk.text === buffer || disk.text === lastWritten.get(path) || (doc.kind === 'markdown' && disk.mtimeMs === doc.mtimeMs)) return;
  if (now.dirty) {
    // Changed in another app while there are unsaved edits here. Both are kept: the other version
    // goes into History, then this one is saved over it.
    const root = await api.history.rootFor(path).catch(() => null);
    if (root) await api.history.checkpoint(root.path, `Changed in another app: ${doc.name}`).catch(() => null);
    toast(
      root
        ? `“${doc.name}” was also changed in another app. Your version is kept; the other one is in History.`
        : `“${doc.name}” was also changed in another app. Your version is kept.`,
      'info',
    );
    await saveNow().catch(reportError);
    return;
  }
  setState({ doc: { ...doc, initialText: disk.text, mtimeMs: disk.mtimeMs, ...(doc.kind === 'markdown' ? { annotations: disk.annotations ?? null, annotationStatus: disk.annotationStatus ?? 'none' } : {}), loadId: ++loadCounter } });
}

/** Saves what is not saved yet; the main process waits for this before the window closes or the app quits. */
export async function flushBeforeClose(): Promise<void> {
  await saveNow().catch(reportError);
}

// ---------- Preview ----------

let renderSeq = 0;

export function previewTarget(): { docPath: string | null; reason?: string } {
  const { doc, previewDocPath } = getState();
  if (!doc) return { docPath: null, reason: 'Open a document to preview it.' };
  if (doc.kind === 'markdown') return { docPath: doc.path };
  if (doc.kind === 'css') return previewDocPath ? { docPath: previewDocPath } : { docPath: null, reason: 'Open a markdown document first; the theme preview uses the last document you opened.' };
  return { docPath: null, reason: 'Preview is available for markdown documents and theme CSS.' };
}

export async function requestRender(): Promise<void> {
  const seq = ++renderSeq;
  const { doc, dirty } = getState();
  const target = previewTarget();
  if (!target.docPath || !doc) {
    setState({ render: null, renderError: target.reason ?? null, rendering: false });
    return;
  }
  setState({ rendering: true, renderError: null });
  try {
    const text = editorBridge.getText();
    const overrides = doc.kind === 'markdown' && dirty && text !== null ? { [doc.path]: text } : undefined;
    const themeOpts =
      doc.kind === 'css' && doc.themeName ? { themeName: doc.themeName, themeCssOverride: text !== null ? { cssPath: doc.path, css: text } : undefined } : {};
    const result = await api.render.document({ docPath: target.docPath, overrides, ...themeOpts });
    if (seq === renderSeq) setState({ render: result, rendering: true });
  } catch (e) {
    if (seq === renderSeq) setState({ renderError: e instanceof Error ? e.message : String(e), rendering: false });
  }
}

export function setMode(mode: 'edit' | 'preview'): void {
  const { doc } = getState();
  if (mode === 'preview' && doc && doc.kind !== 'markdown' && doc.kind !== 'css') {
    toast('Preview is available for markdown documents and theme CSS.');
    return;
  }
  const from = getState().mode;
  setState(mode === 'preview' && from !== 'preview' ? { mode, pageCount: null, previewPage: null } : { mode });
  if (mode === 'preview') requestRender();
  else {
    // Return to where the preview was scrolled to.
    if (from === 'preview' && doc?.kind === 'markdown' && previewPosition.docPath === doc.path && previewPosition.line !== null) editorBridge.scrollToLine(previewPosition.line);
    setTimeout(() => editorBridge.focus(), 0);
  }
}

// ---------- Events ----------

function onEvent(e: AppEvent): void {
  if (e.type === 'library-changed') scheduleTreeReload();
  else if (e.type === 'files-changed') {
    const { doc, mode, render } = getState();
    if (doc && e.paths.includes(doc.path)) reloadIfChanged(doc.path);
    chatFilesChanged(e.paths);
    const { activeGuides } = getState();
    if (e.paths.some((p) => p === activeGuides.voice?.path || p === activeGuides.style?.path || p.includes('/Guides/'))) {
      loadGuides().then(() => refreshActiveGuides()).catch(() => undefined);
    }
    const touchesProjectList = e.paths.some((p) => p.endsWith('/.mdeditor/project.json') || !paths.extname(p));
    if (touchesProjectList) scheduleTreeReload();
    else {
      // Refresh file trees of expanded projects that contain a new/removed file.
      const { projects } = getState();
      for (const projectPath of Object.keys(projects)) {
        if (e.paths.some((p) => paths.isInside(p, projectPath))) loadProject(projectPath);
      }
    }
    if (mode === 'preview' && render && e.paths.some((p) => render.dependencies.includes(p) || p === render.themeCssPath)) requestRender();
    const refs = getState().references;
    if (refs.projectPath && touchesReferences(e.paths, refs.projectPath, refs.items.map((r) => r.path))) loadReferences(refs.projectPath);
  } else if (e.type === 'history-changed') setState((s) => ({ historyVersion: s.historyVersion + 1 }));
  else if (e.type === 'menu') runCommand(e.command);
}

// ---------- Dialogs ----------

export function openDialog(spec: DialogSpec): void {
  setState({ dialog: spec });
}

export function closeDialog(): void {
  setState({ dialog: null });
}

async function withError<T>(fn: () => Promise<T>): Promise<string | void> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function newCollectionDialog(): void {
  openDialog({
    title: 'New Collection',
    message: 'Collections group related projects.',
    fields: [{ name: 'name', label: 'Name', type: 'text', value: '', placeholder: 'e.g. Client Reports' }],
    okLabel: 'Create',
    onSubmit: (v) =>
      withError(async () => {
        const p = await api.library.createCollection(String(v.name).trim());
        setState((s) => ({ expanded: { ...s.expanded, [p]: true } }));
        await loadTree();
      }),
  });
}

async function projectDialog(collection: string | undefined, template: string | null | undefined): Promise<void> {
  const tree = getState().tree ?? (await api.library.tree());
  if (tree.collections.length === 0) {
    toast('Create a collection first.', 'info');
    newCollectionDialog();
    return;
  }
  const fromTemplate = template !== undefined;
  if (fromTemplate && tree.templates.length === 0) {
    toast('There are no templates yet. Use “New Template from Project…” to make one.', 'info');
    return;
  }
  const current = await currentProject();
  const currentCollection = current ? tree.collections.find((c) => c.projects.some((p) => p.path === current))?.name : undefined;
  openDialog({
    title: fromTemplate ? 'New Project from Template' : 'New Project',
    message: fromTemplate ? 'The template’s files are copied into the new project.' : undefined,
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: '', placeholder: 'Project name' },
      { name: 'collection', label: 'Collection', type: 'select', value: collection ?? currentCollection ?? tree.collections[0].name, options: tree.collections.map((c) => ({ value: c.name, label: c.name })) },
      ...(fromTemplate
        ? [{ name: 'template', label: 'Template', type: 'select' as const, value: template ?? tree.templates[0].name, options: tree.templates.map((t) => ({ value: t.name, label: t.name })) }]
        : []),
    ],
    okLabel: 'Create Project',
    onSubmit: (v) =>
      withError(async () => {
        const p = await api.library.createProject({
          collection: String(v.collection),
          name: String(v.name).trim(),
          template: fromTemplate ? String(v.template) : undefined,
        });
        await loadTree();
        await expandTo(p);
        const docs = await api.project.documents(p);
        const main = docs.find((d) => paths.basename(d) === 'main.md') ?? docs[0];
        if (main) await openFile(main, { newTab: true });
      }),
  });
}

/** New blank project. */
export function newProjectDialog(collection?: string): Promise<void> {
  return projectDialog(collection, undefined);
}

/** New project copied from a template; `template` preselects one. */
export function newProjectFromTemplateDialog(collection?: string, template?: string): Promise<void> {
  return projectDialog(collection, template ?? null);
}

/** Saves a copy of a project as a template. */
export async function newTemplateDialog(fromProject?: string): Promise<void> {
  const tree = getState().tree ?? (await api.library.tree());
  const projects = tree.collections.flatMap((c) => c.projects.map((p) => ({ value: p.path, label: `${c.name} › ${p.name}` })));
  if (projects.length === 0) {
    toast('Create a project first; a template is made from a project.', 'info');
    return;
  }
  const source = fromProject ?? (await currentProject()) ?? projects[0].value;
  openDialog({
    title: 'New Template from Project',
    message: 'Copies the project’s files (not its history) into a template. New projects made from the template start with these files.',
    fields: [
      { name: 'project', label: 'Project', type: 'select', value: projects.some((p) => p.value === source) ? source : projects[0].value, options: projects },
      { name: 'name', label: 'Template name', type: 'text', value: '', placeholder: 'e.g. Quarterly Report' },
    ],
    okLabel: 'Create Template',
    onSubmit: (v) =>
      withError(async () => {
        const name = String(v.name).trim() || paths.basename(String(v.project));
        const p = await api.library.createTemplate({ name, fromProject: String(v.project) });
        await loadTree();
        toast(`Template “${paths.basename(p)}” created.`, 'success', { label: `Show in ${FILES_APP}`, run: () => api.library.reveal(p).catch(() => undefined) });
      }),
  });
}

/** Where a new file goes when no folder is given: the open document's folder, else the selected item's project. */
async function defaultFileFolder(): Promise<string | null> {
  const { doc, selected } = getState();
  if (doc?.projectPath) return paths.dirname(doc.path);
  if (selected) return (await api.project.projectFor(selected)) ?? null;
  return null;
}

/** Folders New File… offers: the default folder (when inside a project), then every project. */
function fileFolders(first: string | null): Array<{ value: string; label: string }> {
  const projects = (getState().tree?.collections ?? []).flatMap((c) => c.projects.map((p) => ({ value: p.path, label: `${c.name} › ${p.name}` })));
  const project = first ? projects.find((p) => p.value === first || paths.isInside(first, p.value)) : undefined;
  if (first && project && project.value !== first) projects.unshift({ value: first, label: `${project.label} / ${paths.relative(project.value, first)}` });
  return projects;
}

export async function newFileDialog(dir?: string): Promise<void> {
  // Given a folder (a project or folder's menu), the file goes there; otherwise the dialog asks where.
  const start = dir ? null : await defaultFileFolder();
  const folders = dir ? [] : fileFolders(start);
  if (!dir && !folders.length) {
    toast('Create a project first.');
    return;
  }
  openDialog({
    title: 'New File',
    message: dir ? `In ${paths.basename(dir)}` : undefined,
    fields: [
      { name: 'name', label: 'File name', type: 'text', value: 'Untitled.md', help: 'Markdown files end in .md' },
      ...(dir ? [] : [{ name: 'folder', label: 'Location', type: 'select' as const, value: folders.find((f) => f.value === start)?.value ?? folders[0].value, options: folders }]),
    ],
    okLabel: 'Create',
    onSubmit: (v) =>
      withError(async () => {
        let name = String(v.name).trim();
        if (!paths.extname(name)) name += '.md';
        const p = await api.files.createFile(dir ?? String(v.folder), name, isMarkdownFile(name) ? '' : undefined);
        const project = await api.project.projectFor(p);
        if (project) await loadProject(project);
        await openFile(p, { newTab: true });
      }),
  });
}

export function newFolderDialog(dir: string): void {
  openDialog({
    title: 'New Folder',
    fields: [{ name: 'name', label: 'Folder name', type: 'text', value: '' }],
    okLabel: 'Create',
    onSubmit: (v) =>
      withError(async () => {
        const p = await api.files.createFolder(dir, String(v.name).trim());
        setState((s) => ({ expanded: { ...s.expanded, [p]: true, [dir]: true } }));
        const project = await api.project.projectFor(p);
        if (project) await loadProject(project);
      }),
  });
}

export function renameDialog(path: string): void {
  openDialog({
    title: 'Rename',
    fields: [{ name: 'name', label: 'Name', type: 'text', value: paths.basename(path) }],
    okLabel: 'Rename',
    onSubmit: (v) =>
      withError(async () => {
        await saveNow();
        const dest = await api.library.rename(path, String(v.name).trim());
        // Tabs follow the file (or the folder holding it) to its new name.
        const moved = (p: string) => dest + p.slice(path.length);
        const { doc, tabs, activeTab } = getState();
        // Their editors too, with undo history.
        editorBridge.moved(path, dest);
        setState({ tabs: tabs.map((t) => (t.path && paths.isInside(t.path, path) ? { ...t, path: moved(t.path) } : t)) });
        persistTabs();
        if (doc && paths.isInside(doc.path, path)) {
          editorBridge.keep(activeTab, moved(doc.path));
          setState({ doc: null });
          await loadDocument(moved(doc.path));
        }
        await loadTree();
        const project = await api.project.projectFor(dest).catch(() => null);
        if (project) await loadProject(project);
      }),
  });
}

export async function trashPath(path: string): Promise<void> {
  const ok = await api.ui.confirm(`Move “${paths.basename(path)}” to the Trash?`, isIpad ? 'You can restore it from Recently Deleted in Files.' : 'You can restore it from the Trash in Finder.', 'Move to Trash');
  if (!ok) return;
  try {
    // The trashed file has the last edits.
    if (getState().doc && paths.isInside(getState().doc!.path, path)) await saveNow();
    await closeTabsInside(path);
    await api.library.trash(path);
    await loadTree();
    const project = await api.project.projectFor(paths.dirname(path)).catch(() => null);
    if (project) await loadProject(project);
  } catch (e) {
    reportError(e);
  }
}

export function newGuideDialog(kind: GuideInfo['kind'], from?: string): void {
  const existing = getState().guides.filter((g) => g.kind === kind);
  openDialog({
    title: kind === 'voice' ? 'New Voice Guide' : 'New Style Guide',
    message:
      kind === 'voice'
        ? 'A voice guide describes how the writing should sound. The AI reads it when drafting.'
        : 'A style guide picks a base (AP-like, Chicago-like, Oxford-like, or none) and overrides individual rules.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: '' },
      { name: 'from', label: 'Start from', type: 'select', value: from ?? '', options: [{ value: '', label: 'Blank' }, ...existing.map((g) => ({ value: g.name, label: `Copy of ${g.name}` }))] },
    ],
    okLabel: 'Create',
    onSubmit: (v) =>
      withError(async () => {
        const g = await api.guides.create(kind, String(v.name).trim(), v.from ? String(v.from) : undefined);
        await loadGuides();
        await openFile(g.path, { newTab: true });
      }),
  });
}

export function newThemeDialog(from?: string): void {
  const themes = getState().tree?.themes ?? [];
  openDialog({
    title: 'New Theme',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: from ? `${from} Copy` : '' },
      { name: 'from', label: 'Based on', type: 'select', value: from ?? themes[0]?.name ?? '', options: [{ value: '', label: 'Empty theme' }, ...themes.map((t) => ({ value: t.name, label: t.name }))] },
    ],
    okLabel: 'Create Theme',
    onSubmit: (v) =>
      withError(async () => {
        const t = await api.themes.create(String(v.name).trim(), v.from ? String(v.from) : undefined);
        await loadTree();
        await openFile(t.cssPath, { newTab: true });
      }),
  });
}

export async function exportPdfDialog(target: { docPath?: string; projectPath?: string } = {}): Promise<void> {
  await saveNow();
  const { docPath } = target;
  const project = target.projectPath ?? (docPath ? await api.project.projectFor(docPath) : await currentProject());
  if (!project) {
    toast('Open a document or select a project to export.');
    return;
  }
  const docs = await api.project.documents(project);
  if (docs.length === 0) {
    toast('This project has no markdown documents.');
    return;
  }
  const details = await api.project.details(project);
  const { doc } = getState();
  const preferred =
    docPath ?? (doc?.kind === 'markdown' && doc.projectPath === project ? doc.path : details.meta.lastExport ? `${project}/${details.meta.lastExport}` : docs.find((d) => paths.basename(d) === 'main.md') ?? docs[0]);
  setState({ exportDialog: { projectPath: project, documents: docs, docPath: docs.includes(preferred) ? preferred : docs[0] } });
}

/** Checks the document, asks about problems, then exports with the given arrangement. */
export async function runPdfExport(docPath: string, arrangement: ExportPart[] | undefined, extraProblems: string[] = [], options: { headingsFromH1?: boolean } = {}): Promise<void> {
  try {
    const result = await api.render.document({ docPath });
    // With headings tagged from H1, a first heading below level 1 is not a problem in the PDF.
    const fromH1 = options.headingsFromH1 ?? true;
    const problems = [...result.warnings.filter((w) => w.kind !== 'outside-project' && !(fromH1 && w.code === 'first-heading-level')).map((w) => w.message), ...extraProblems];
    if (problems.length) {
      const ok = await api.ui.confirm(
        `${problems.length} problem${problems.length > 1 ? 's' : ''} found in this export.`,
        problems.slice(0, 6).map((m) => `• ${m}`).join('\n') + '\n\nExport anyway?',
        'Export',
      );
      if (!ok) return;
    }
    toast('Exporting PDF…');
    const r = await api.exports.pdf({ docPath, arrangement, headingsFromH1: options.headingsFromH1 });
    if (r) toast(`Exported ${paths.basename(r.path)}`, 'success', { label: `Show in ${FILES_APP}`, run: () => api.library.reveal(r.path).catch(() => undefined) });
  } catch (e) {
    reportError(e);
  }
}

/** Exports a document as one self-contained web page. */
export async function exportHtml(docPath?: string): Promise<void> {
  await saveNow();
  const { doc } = getState();
  const path = docPath ?? (doc?.kind === 'markdown' ? doc.path : null);
  if (!path) {
    toast('Open a markdown document to export it as a web page.');
    return;
  }
  try {
    toast('Exporting web page…');
    const r = await api.exports.html({ docPath: path });
    if (r) toast(`Exported ${paths.basename(r.path)}`, 'success', { label: `Show in ${FILES_APP}`, run: () => api.library.reveal(r.path).catch(() => undefined) });
  } catch (e) {
    reportError(e);
  }
}

export async function exportZipDialog(projectPath?: string): Promise<void> {
  await saveNow();
  const project = projectPath ?? (await currentProject());
  if (!project) {
    toast('Select a project to export.');
    return;
  }
  openDialog({
    title: 'Export ZIP',
    message: `Exports the “${paths.basename(project)}” project folder.`,
    fields: [{ name: 'history', label: 'Include version history', type: 'checkbox', value: false }],
    okLabel: 'Export…',
    onSubmit: async (v) => {
      closeDialog();
      try {
        const r = await api.exports.zip({ projectPath: project, includeHistory: !!v.history });
        if (r) toast(`Exported ${paths.basename(r.path)}`, 'success');
      } catch (e) {
        reportError(e);
      }
    },
  });
}

export async function checkpointDialog(): Promise<void> {
  await saveNow();
  const root = await currentHistoryRoot();
  if (!root) {
    toast('Open a project document, theme or guide first.');
    return;
  }
  const project = root.path;
  openDialog({
    title: 'Create Checkpoint',
    message: root.kind === 'library' ? `Saves the current state of all ${root.name.toLowerCase()} in the library as a named version.` : `Saves the current state of “${root.name}” as a named version.`,
    fields: [{ name: 'name', label: 'Name', type: 'text', value: '', placeholder: 'e.g. Sent to client' }],
    okLabel: 'Create',
    onSubmit: (v) =>
      withError(async () => {
        await api.history.checkpoint(project, String(v.name));
        setState({ panel: 'history' });
        toast('Checkpoint created.', 'success');
      }),
  });
}

export function chooseLibraryDialog(): void {
  (async () => {
    const path = await api.app.chooseFolder('Choose a library folder');
    if (path) await openLibrary(path, true);
  })().catch(reportError);
}

// ---------- Commands ----------

const nextZoom = (current: number, delta: number | null, min: number) => (delta === null ? 1 : Math.min(3, Math.max(min, Math.round((current + delta) * 10) / 10)));

/** Zooms the preview, or the editor text when editing (kept between sessions). */
export function zoomBy(delta: number | null): void {
  const { mode, prefs, doc } = getState();
  if (mode === 'edit' && doc && doc.kind !== 'image' && doc.kind !== 'unsupported') {
    if (prefs) updatePrefs({ editorZoom: nextZoom(prefs.editorZoom || 1, delta, 0.5) });
    return;
  }
  setState((s) => ({ zoom: nextZoom(s.zoom, delta, 0.4) }));
}

export function runCommand(command: MenuCommand): void {
  const s = getState();
  switch (command) {
    case 'export-html':
      exportHtml();
      break;
    case 'find-in-library':
      if (s.prefs?.showLibrary === false) updatePrefs({ showLibrary: true });
      setTimeout(() => document.getElementById('library-search')?.focus(), 0);
      break;
    case 'new-tab':
      newTab().catch(reportError);
      break;
    case 'close-tab':
      closeTab().catch(reportError);
      break;
    case 'next-tab':
      cycleTab(1);
      break;
    case 'previous-tab':
      cycleTab(-1);
      break;
    case 'toggle-library':
      if (s.prefs) updatePrefs({ showLibrary: !s.prefs.showLibrary });
      break;
    case 'format-bold':
    case 'format-italic':
    case 'format-mark': {
      const view = editorBridge.view;
      if (!view || s.mode !== 'edit' || s.doc?.kind !== 'markdown') {
        toast('Open a markdown document in the editor first.');
        break;
      }
      view.focus();
      runEditCommand(view, command, 'menu');
      break;
    }
    case 'find-replace':
    case 'replace-all':
    case 'select-all-occurrences':
    case 'select-next-occurrence': {
      const view = editorBridge.view;
      if (!view || s.mode !== 'edit') {
        toast('Open a document in the editor first.');
        break;
      }
      // Find and Replace puts the cursor in the Find field; the others work in the text.
      if (command.startsWith('select-')) view.focus();
      runEditCommand(view, command, 'menu');
      break;
    }
    case 'toggle-preview':
      setMode(s.mode === 'edit' ? 'preview' : 'edit');
      break;
    case 'new-file':
      newFileDialog();
      break;
    case 'new-project':
      newProjectDialog();
      break;
    case 'new-collection':
      newCollectionDialog();
      break;
    case 'new-project-from-template':
      newProjectFromTemplateDialog();
      break;
    case 'new-template':
      newTemplateDialog();
      break;
    case 'export-pdf':
      exportPdfDialog();
      break;
    case 'export-zip':
      exportZipDialog();
      break;
    case 'checkpoint':
      checkpointDialog();
      break;
    case 'show-history':
      setState({ panel: s.panel === 'history' ? null : 'history' });
      break;
    case 'settings':
      setState({ settingsOpen: true });
      break;
    case 'ai-command':
      openCommandBar();
      break;
    case 'ai-chat':
      setState({ panel: s.panel === 'assistant' ? null : 'assistant' });
      break;
    case 'ai-review':
      runReview();
      break;
    case 'insights':
      setState({ panel: s.panel === 'insights' ? null : 'insights' });
      break;
    case 'toggle-authorship':
      if (s.prefs) updatePrefs({ showAuthorship: !s.prefs.showAuthorship });
      break;
    case 'convert-quotes': {
      if (s.doc?.kind !== 'markdown' || s.mode !== 'edit') {
        toast('Open a markdown document in the editor first.');
        break;
      }
      const n = editorBridge.convertQuotes();
      toast(n ? `Made ${n} replacement${n === 1 ? '' : 's'}.` : 'No straight quotes or double hyphens to convert.');
      break;
    }
    case 'save':
      saveNow().catch(reportError);
      break;
    case 'zoom-in':
      zoomBy(0.1);
      break;
    case 'zoom-out':
      zoomBy(-0.1);
      break;
    case 'zoom-reset':
      zoomBy(null);
      break;
  }
}

const listNames = (names: string[]) => names.map((n) => `“${n}”`).join(', ');

/** Saves a library theme as a .mdtheme package and says which fonts and images travel with it. */
export async function exportTheme(name: string): Promise<void> {
  try {
    const r = await api.themes.exportTheme(name);
    if (!r) return;
    const notes = [
      r.fonts.packaged.length ? `Fonts included: ${listNames(r.fonts.packaged)}.` : '',
      r.fonts.byName.length ? `Not included (installed fonts it names): ${listNames(r.fonts.byName)}; elsewhere the next font in each list is used. Add font files with Add Fonts… to include them.` : '',
      r.fonts.missingFiles.length ? `Missing font files: ${r.fonts.missingFiles.join(', ')}.` : '',
      r.images.packaged.length ? `Images included: ${r.images.packaged.length}.` : '',
      r.images.copied?.length ? `Copied in from the library: ${r.images.copied.join(', ')}.` : '',
      r.images.outside.length ? `Images not included (outside the library, or not found): ${r.images.outside.join(', ')}.` : '',
      r.images.missing.length ? `Missing images: ${r.images.missing.join(', ')}.` : '',
    ].filter(Boolean);
    toast(`Exported ${paths.basename(r.path)}. ${notes.join(' ')}`, 'success', { label: `Show in ${FILES_APP}`, run: () => api.library.reveal(r.path).catch(() => undefined) });
  } catch (e) {
    reportError(e);
  }
}

export async function importTheme(): Promise<void> {
  try {
    const r = await api.themes.importTheme();
    if (!r) return;
    await loadTree();
    const count = r.images.packaged.length;
    const notes = [
      count ? `It includes ${count} image${count === 1 ? '' : 's'}.` : '',
      r.fonts.byName.length ? `It names fonts that must be installed to show as designed: ${listNames(r.fonts.byName)}.` : '',
      r.images.missing.length || r.images.outside.length ? `Images it refers to but does not include: ${[...r.images.missing, ...r.images.outside].join(', ')}.` : '',
    ].filter(Boolean);
    toast(`Imported theme “${r.theme.name}”.${notes.map((n) => ` ${n}`).join('')}`, 'success');
  } catch (e) {
    reportError(e);
  }
}

/** Copies font files into a theme so they are part of it (and of its exports). */
export async function addFontsToTheme(name: string): Promise<void> {
  try {
    const families = await api.themes.addFonts(name);
    if (!families.length) return;
    toast(`Added ${listNames(families)} to “${name}”. Use the family name in the theme’s CSS (font-family). Include only fonts whose licence allows it.`, 'success');
    if (getState().mode === 'preview') requestRender();
  } catch (e) {
    reportError(e);
  }
}

/** Copies images into a theme so they are part of it (and of its exports). */
export async function addImagesToTheme(name: string): Promise<void> {
  try {
    const added = await api.themes.addImages(name);
    if (!added.length) return;
    const css = added.map((p) => `url("${p}")`).join('\n');
    toast(`Added ${added.join(', ')} to “${name}”. In the theme’s CSS use url("${added[0]}"); in a component, {{ "${added[0]}" | theme_url }}.`, 'success', {
      label: 'Copy CSS',
      run: () => navigator.clipboard.writeText(css).catch(() => undefined),
    });
  } catch (e) {
    reportError(e);
  }
}

export async function setProjectTheme(projectPath: string, theme: string): Promise<void> {
  try {
    await api.project.updateMeta(projectPath, { theme });
    await loadProject(projectPath);
    if (getState().mode === 'preview') requestRender();
  } catch (e) {
    reportError(e);
  }
}

export async function customizeTheme(projectPath: string, theme: string): Promise<void> {
  try {
    const t = await api.themes.fork(projectPath, theme);
    await loadProject(projectPath);
    toast(`“${theme}” copied into this project. Changes affect this project only.`, 'success');
    await openFile(t.cssPath);
  } catch (e) {
    reportError(e);
  }
}
