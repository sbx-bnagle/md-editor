// UI behaviour that is not tied to one component. Talks to the host only through `api`.

import { paths, isImageFile, isMarkdownFile, type AppEvent, type GuideInfo, type MenuCommand, type ProjectDetails } from '@mde/core';
import { ApiError, api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { hasAiText } from '../editor/authorship';
import { openCommandBar, runReview } from '../ai/actions';
import { refreshActiveGuides } from '../ai/context';
import { loadPrefs, updatePrefs } from './prefs';
import { getState, setState, toast, type DialogSpec, type OpenDoc, type OpenKind } from './store';

const TEXT_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.sh', '.html', '.xml', '.swift', '.rb', '.go', '.rs', '.sql', '.toml', '.ini']);

export function reportError(e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  toast(message, 'error');
  if (!(e instanceof ApiError && e.userFacing)) console.error(e);
}

function kindFor(path: string): OpenKind {
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
  try {
    const app = await api.app.state();
    setState({ app });
    await loadPrefs().catch(reportError);
    if (app.libraryPath) {
      await loadTree();
      if (app.lastDocument) {
        const project = await api.project.projectFor(app.lastDocument).catch(() => null);
        if (project) await expandTo(project);
        await openFile(app.lastDocument).catch(() => undefined);
      }
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
    setState({ app, tree: null, projects: {}, expanded: {}, doc: null, render: null });
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

export async function loadProject(path: string): Promise<ProjectDetails | null> {
  try {
    const details = await api.project.details(path);
    setState((s) => ({ projects: { ...s.projects, [path]: details } }));
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

// ---------- Documents ----------

export async function openFile(path: string): Promise<void> {
  const cur = getState().doc;
  if (cur?.path === path) return;
  await saveNow();
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
  try {
    if (kind === 'markdown') {
      const d = await api.files.readDocument(path);
      setState({
        doc: { ...base, initialText: d.text, mtimeMs: d.mtimeMs, annotations: d.annotations, annotationStatus: d.annotationStatus },
        dirty: false,
        previewDocPath: path,
        selected: path,
      });
      if (d.annotationStatus === 'invalid') {
        toast('Authorship annotations in this file do not match its text (it was edited elsewhere). They are kept but may be misplaced.', 'info');
      }
    } else if (kind === 'css' || kind === 'text') {
      const text = await api.files.readText(path);
      setState({ doc: { ...base, initialText: text, mtimeMs: Date.now(), annotations: null, annotationStatus: 'none' }, dirty: false, selected: path });
    } else {
      setState({ doc: { ...base, initialText: '', mtimeMs: 0, annotations: null, annotationStatus: 'none' }, dirty: false, selected: path, mode: 'edit' });
    }
    await api.app.setLastDocument(path).catch(() => undefined);
    if (getState().review && getState().review?.docPath !== path) setState({ review: null });
    refreshActiveGuides().catch(() => undefined);
    if (getState().mode === 'preview') requestRender();
  } catch (e) {
    reportError(e);
  }
}

export async function closeDocument(): Promise<void> {
  await saveNow();
  setState({ doc: null, dirty: false, render: null });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<void> | null = null;

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
  const { doc, dirty } = getState();
  if (!doc || doc.path !== path || dirty) return;
  try {
    if (doc.kind === 'markdown') {
      const d = await api.files.readDocument(path);
      if (d.mtimeMs === doc.mtimeMs || d.text === editorBridge.getText()) return;
      setState({ doc: { ...doc, initialText: d.text, mtimeMs: d.mtimeMs, annotations: d.annotations, annotationStatus: d.annotationStatus, loadId: ++loadCounter } });
    } else if (doc.kind === 'css' || doc.kind === 'text') {
      const text = await api.files.readText(path);
      if (text === editorBridge.getText()) return;
      setState({ doc: { ...doc, initialText: text, loadId: ++loadCounter } });
    }
  } catch {
    // File removed: keep the buffer; the next save recreates it.
  }
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
  setState({ mode });
  if (mode === 'preview') requestRender();
  else setTimeout(() => editorBridge.focus(), 0);
}

// ---------- Events ----------

function onEvent(e: AppEvent): void {
  if (e.type === 'library-changed') scheduleTreeReload();
  else if (e.type === 'files-changed') {
    const { doc, mode, render } = getState();
    if (doc && e.paths.includes(doc.path)) reloadIfChanged(doc.path);
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

export async function newProjectDialog(collection?: string, template?: string): Promise<void> {
  const tree = getState().tree ?? (await api.library.tree());
  if (tree.collections.length === 0) {
    toast('Create a collection first.', 'info');
    newCollectionDialog();
    return;
  }
  const current = await currentProject();
  const currentCollection = current ? tree.collections.find((c) => c.projects.some((p) => p.path === current))?.name : undefined;
  openDialog({
    title: 'New Project',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: '', placeholder: 'Project name' },
      { name: 'collection', label: 'Collection', type: 'select', value: collection ?? currentCollection ?? tree.collections[0].name, options: tree.collections.map((c) => ({ value: c.name, label: c.name })) },
      {
        name: 'source',
        label: 'Start from',
        type: 'radio',
        value: template ? 'template' : tree.templates.length ? 'template' : 'blank',
        options: [
          { value: 'template', label: 'Template', disabled: tree.templates.length === 0 },
          { value: 'blank', label: 'Blank project' },
        ],
      },
      {
        name: 'template',
        label: 'Template',
        type: 'select',
        value: template ?? tree.templates[0]?.name ?? '',
        options: tree.templates.map((t) => ({ value: t.name, label: t.name })),
        showIf: { field: 'source', equals: 'template' },
      },
    ],
    okLabel: 'Create Project',
    onSubmit: (v) =>
      withError(async () => {
        const p = await api.library.createProject({
          collection: String(v.collection),
          name: String(v.name).trim(),
          template: v.source === 'template' ? String(v.template) : undefined,
        });
        await loadTree();
        await expandTo(p);
        const docs = await api.project.documents(p);
        const main = docs.find((d) => paths.basename(d) === 'main.md') ?? docs[0];
        if (main) await openFile(main);
      }),
  });
}

export async function newTemplateDialog(fromProject?: string): Promise<void> {
  const tree = getState().tree ?? (await api.library.tree());
  const projects = tree.collections.flatMap((c) => c.projects.map((p) => ({ value: p.path, label: `${c.name} › ${p.name}` })));
  openDialog({
    title: 'New Template',
    message: 'A template is a project folder whose files are copied into each new project made from it.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: '' },
      {
        name: 'source',
        label: 'Start from',
        type: 'radio',
        value: fromProject ? 'project' : 'blank',
        options: [
          { value: 'blank', label: 'Blank' },
          { value: 'project', label: 'Copy of a project', disabled: projects.length === 0 },
        ],
      },
      { name: 'project', label: 'Project', type: 'select', value: fromProject ?? projects[0]?.value ?? '', options: projects, showIf: { field: 'source', equals: 'project' } },
    ],
    okLabel: 'Create Template',
    onSubmit: (v) =>
      withError(async () => {
        const p = await api.library.createTemplate({ name: String(v.name).trim(), fromProject: v.source === 'project' ? String(v.project) : undefined });
        await loadTree();
        setState((s) => ({ expanded: { ...s.expanded, [p]: true } }));
        await loadProject(p);
      }),
  });
}

export async function newFileDialog(dir?: string): Promise<void> {
  const target = dir ?? (await (async () => {
    const { doc, selected } = getState();
    if (doc?.projectPath) return paths.dirname(doc.path);
    if (selected) return (await api.project.projectFor(selected)) ?? null;
    return null;
  })());
  if (!target) {
    toast('Select a project first.');
    return;
  }
  openDialog({
    title: 'New File',
    message: `In ${paths.basename(target)}`,
    fields: [{ name: 'name', label: 'File name', type: 'text', value: 'Untitled.md', help: 'Markdown files end in .md' }],
    okLabel: 'Create',
    onSubmit: (v) =>
      withError(async () => {
        let name = String(v.name).trim();
        if (!paths.extname(name)) name += '.md';
        const p = await api.files.createFile(target, name, isMarkdownFile(name) ? '' : undefined);
        const project = await api.project.projectFor(p);
        if (project) await loadProject(project);
        await openFile(p);
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
        const { doc } = getState();
        if (doc && paths.isInside(doc.path, path)) {
          const moved = dest + doc.path.slice(path.length);
          setState({ doc: null });
          await openFile(moved);
        }
        await loadTree();
        const project = await api.project.projectFor(dest).catch(() => null);
        if (project) await loadProject(project);
      }),
  });
}

export async function trashPath(path: string): Promise<void> {
  const ok = await api.ui.confirm(`Move “${paths.basename(path)}” to the Trash?`, 'You can restore it from the Trash in Finder.', 'Move to Trash');
  if (!ok) return;
  try {
    const { doc } = getState();
    if (doc && paths.isInside(doc.path, path)) setState({ doc: null, dirty: false, render: null });
    await api.library.trash(path);
    await loadTree();
    const project = await api.project.projectFor(paths.dirname(path)).catch(() => null);
    if (project) await loadProject(project);
  } catch (e) {
    reportError(e);
  }
}

export function newGuideDialog(kind: GuideInfo['kind']): void {
  const existing = getState().guides.filter((g) => g.kind === kind);
  openDialog({
    title: kind === 'voice' ? 'New Voice Guide' : 'New Style Guide',
    message:
      kind === 'voice'
        ? 'A voice guide describes how the writing should sound. The AI reads it when drafting.'
        : 'A style guide picks a base (AP-like, Chicago-like, Oxford-like, or none) and overrides individual rules.',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: '' },
      { name: 'from', label: 'Start from', type: 'select', value: '', options: [{ value: '', label: 'Blank' }, ...existing.map((g) => ({ value: g.name, label: `Copy of ${g.name}` }))] },
    ],
    okLabel: 'Create',
    onSubmit: (v) =>
      withError(async () => {
        const g = await api.guides.create(kind, String(v.name).trim(), v.from ? String(v.from) : undefined);
        await loadGuides();
        await openFile(g.path);
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
        await openFile(t.cssPath);
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
  openDialog({
    title: 'Export PDF',
    message: 'Choose the document to export. Its content blocks are included.',
    fields: [
      {
        name: 'doc',
        label: 'Document',
        type: 'select',
        value: docs.includes(preferred) ? preferred : docs[0],
        options: docs.map((d) => ({ value: d, label: paths.relative(project, d) })),
      },
    ],
    okLabel: 'Export…',
    onSubmit: async (v) => {
      closeDialog();
      try {
        const result = await api.render.document({ docPath: String(v.doc) });
        const problems = result.warnings.filter((w) => w.kind !== 'outside-project');
        if (problems.length) {
          const ok = await api.ui.confirm(
            `${problems.length} problem${problems.length > 1 ? 's' : ''} found in this document.`,
            problems.slice(0, 6).map((w) => `• ${w.message}`).join('\n') + '\n\nExport anyway?',
            'Export',
          );
          if (!ok) return;
        }
        toast('Exporting PDF…');
        const r = await api.exports.pdf({ docPath: String(v.doc) });
        if (r) toast(`Exported ${paths.basename(r.path)}`, 'success', { label: 'Show in Finder', run: () => api.library.reveal(r.path).catch(() => undefined) });
      } catch (e) {
        reportError(e);
      }
    },
  });
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
  const project = await currentProject();
  if (!project) {
    toast('Open a project document first.');
    return;
  }
  openDialog({
    title: 'Create Checkpoint',
    message: `Saves the current state of “${paths.basename(project)}” as a named version.`,
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

export function zoomBy(delta: number | null): void {
  setState((s) => ({ zoom: delta === null ? 1 : Math.min(3, Math.max(0.4, Math.round((s.zoom + delta) * 10) / 10)) }));
}

export function runCommand(command: MenuCommand): void {
  const s = getState();
  switch (command) {
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
