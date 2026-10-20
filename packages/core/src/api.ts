// The contract between the UI and its host. The UI only ever talks to an AppApi.
// The Electron host implements it over IPC (apps/desktop); another host (Tauri, a web
// server, a native shell running a JS engine) implements the same interface.
// Every method is async and takes/returns plain serializable data.

import type { ComposeWarning } from './render/compose';
import type { SnapshotKind } from './history';
import type { DiffHunk } from './diff';
import type { AnnotationBlock } from './annotations';
import type { ProjectMeta } from './library';

export interface ProjectRef {
  name: string;
  path: string;
  kind: 'project' | 'template';
  /** Collection name for projects. */
  collection?: string;
}

export interface CollectionInfo {
  name: string;
  path: string;
  projects: ProjectRef[];
}

export interface ThemeInfo {
  name: string;
  /** Folder containing theme.css. */
  path: string;
  cssPath: string;
  scope: 'library' | 'project';
}

export interface LibraryTree {
  root: string;
  collections: CollectionInfo[];
  templates: ProjectRef[];
  themes: ThemeInfo[];
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileEntry[];
}

export interface ProjectDetails {
  ref: ProjectRef;
  meta: ProjectMeta;
  files: FileEntry[];
  /** Library themes plus this project's forks (forks shadow library themes of the same name). */
  themes: ThemeInfo[];
}

export interface DocumentFile {
  path: string;
  /** Text without the authorship annotation block. */
  text: string;
  annotations: AnnotationBlock | null;
  /** 'invalid' when the annotation hash does not match the text. */
  annotationStatus: 'none' | 'valid' | 'invalid';
  mtimeMs: number;
}

export interface SaveDocumentRequest {
  path: string;
  text: string;
  /** Author spans in UTF-16 offsets; omitted when the document has no annotations. */
  spans?: Array<{ author: string; from: number; to: number }>;
  annotations?: AnnotationBlock | null;
}

export interface RenderRequest {
  docPath: string;
  /** Unsaved editor buffers by absolute path. */
  overrides?: Record<string, string>;
  /** Render with this theme instead of the document/project selection. */
  themeName?: string;
  /** Unsaved theme CSS (theme editor). */
  themeCssOverride?: { cssPath: string; css: string };
}

export interface RenderResult {
  html: string;
  css: string;
  /** Document title for PDF metadata. */
  title: string;
  themeName: string;
  themeCssPath: string | null;
  warnings: ComposeWarning[];
  dependencies: string[];
  variables: Record<string, string>;
}

export interface SnapshotInfo {
  id: string;
  time: number;
  kind: SnapshotKind;
  name?: string;
  fileCount: number;
  /** Files changed relative to the previous snapshot. */
  changeCount: number;
}

export interface SnapshotChangeInfo {
  path: string;
  status: 'added' | 'removed' | 'modified';
  binary: boolean;
}

export interface FileDiffResult {
  path: string;
  binary: boolean;
  hunks: DiffHunk[];
  /** True when the content is identical. */
  same: boolean;
}

export interface AppState {
  libraryPath: string | null;
  platform: string;
  version: string;
  /** Last opened document, for restoring the session. */
  lastDocument: string | null;
}

export interface ExportPdfRequest {
  docPath: string;
  /** Destination; when omitted the host asks with a save dialog. */
  outPath?: string;
}

export interface ExportZipRequest {
  projectPath: string;
  includeHistory: boolean;
  outPath?: string;
}

export type AppEvent =
  | { type: 'library-changed' }
  | { type: 'files-changed'; paths: string[] }
  | { type: 'history-changed'; projectPath: string }
  | { type: 'menu'; command: MenuCommand };

export type MenuCommand =
  | 'toggle-preview'
  | 'new-file'
  | 'new-project'
  | 'new-collection'
  | 'new-template'
  | 'export-pdf'
  | 'export-zip'
  | 'checkpoint'
  | 'show-history'
  | 'convert-quotes'
  | 'save'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset';

export interface AppApi {
  app: {
    state(): Promise<AppState>;
    defaultLibraryPath(): Promise<string>;
    /** Opens (and when `create` is true, initialises) a library folder. */
    openLibrary(path: string, create: boolean): Promise<AppState>;
    chooseFolder(title: string): Promise<string | null>;
    setLastDocument(path: string | null): Promise<void>;
  };
  library: {
    tree(): Promise<LibraryTree>;
    createCollection(name: string): Promise<string>;
    createProject(req: { collection: string; name: string; template?: string }): Promise<string>;
    createTemplate(req: { name: string; fromProject?: string }): Promise<string>;
    rename(path: string, newName: string): Promise<string>;
    trash(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
  };
  project: {
    details(projectPath: string): Promise<ProjectDetails>;
    updateMeta(projectPath: string, patch: Partial<ProjectMeta>): Promise<ProjectMeta>;
    /** Project folder that contains `path`, or null. */
    projectFor(path: string): Promise<string | null>;
    /** Markdown files in the project (for export selection). */
    documents(projectPath: string): Promise<string[]>;
  };
  files: {
    readDocument(path: string): Promise<DocumentFile>;
    saveDocument(req: SaveDocumentRequest): Promise<{ mtimeMs: number }>;
    readText(path: string): Promise<string>;
    writeText(path: string, text: string): Promise<void>;
    createFile(dir: string, name: string, content?: string): Promise<string>;
    createFolder(dir: string, name: string): Promise<string>;
  };
  themes: {
    list(projectPath?: string): Promise<ThemeInfo[]>;
    create(name: string, from?: string): Promise<ThemeInfo>;
    /** Copies a library theme into the project so it can be customised for that project only. */
    fork(projectPath: string, themeName: string): Promise<ThemeInfo>;
  };
  render: {
    document(req: RenderRequest): Promise<RenderResult>;
  };
  history: {
    list(projectPath: string): Promise<SnapshotInfo[]>;
    checkpoint(projectPath: string, name: string): Promise<SnapshotInfo | null>;
    changes(projectPath: string, snapshotId: string): Promise<SnapshotChangeInfo[]>;
    /** Diff of one file between a snapshot and the current file ('current') or another snapshot. */
    diff(projectPath: string, snapshotId: string, path: string, against: 'previous' | 'current'): Promise<FileDiffResult>;
    restoreFile(projectPath: string, snapshotId: string, path: string): Promise<void>;
    restoreProject(projectPath: string, snapshotId: string): Promise<void>;
    /** Tells the history service that files changed (starts the idle timer). */
    touched(projectPath: string): Promise<void>;
  };
  exports: {
    pdf(req: ExportPdfRequest): Promise<{ path: string } | null>;
    zip(req: ExportZipRequest): Promise<{ path: string } | null>;
  };
  spell: {
    /** Returns misspelled words among `words`. */
    check(words: string[]): Promise<string[]>;
    suggest(word: string): Promise<string[]>;
    learn(word: string): Promise<void>;
    available(): Promise<boolean>;
  };
  ui: {
    confirm(message: string, detail?: string, okLabel?: string): Promise<boolean>;
    showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  };
  events: {
    subscribe(listener: (e: AppEvent) => void): () => void;
  };
}

export interface ContextMenuItem {
  id?: string;
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  /** Native edit action performed by the host instead of returning an id. */
  role?: 'cut' | 'copy' | 'paste' | 'selectAll';
}
