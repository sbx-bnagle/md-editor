// The contract between the UI and its host. The UI only ever talks to an AppApi.
// The Electron host implements it over IPC (apps/desktop); another host (Tauri, a web
// server, a native shell running a JS engine) implements the same interface.
// Every method is async and takes/returns plain serializable data.

import type { ComposeWarning } from './render/compose';
import type { SnapshotKind } from './history';
import type { DiffHunk } from './diff';
import type { AnnotationBlock } from './annotations';
import type { ExportPart, ProjectMeta } from './library';
import type { AiInsertion, AiRequest, AiResult, ChatTurn } from './ai';
import type { Preferences } from './prefs';
import type { ComponentSpec } from './componentSpec';
import type { ThesaurusOptions, ThesaurusResult } from './thesaurus';
import type { ReferenceInfo } from './references';
import type { TagColor } from './finderTags';
import type { ThemeFontReport } from './themeFonts';
import type { ThemeImageReport } from './themeImages';

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
  /** The first heading of the document (with included files), if any. */
  firstHeading?: { level: number; text: string };
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
  /** Open tabs (a null path is an empty tab) and the index of the active one, for restoring the session. */
  openTabs: OpenTabs | null;
}

export interface OpenTabs {
  paths: Array<string | null>;
  active: number;
}

export interface ExportPdfRequest {
  docPath: string;
  /** Destination; when omitted the host asks with a save dialog. */
  outPath?: string;
  /** Parts before and after the document; when omitted the project's saved arrangement is used. */
  arrangement?: ExportPart[];
  /**
   * When the document starts below level 1, tag its headings from H1 (same look). When omitted, the
   * choice saved for the document is used, else true.
   */
  headingsFromH1?: boolean;
}

export interface TransferRequest {
  source: string;
  /** A project folder, or a folder inside a project. */
  targetDir: string;
  copy: boolean;
  /** For a name that is taken: replace the item there (it goes to the Trash), or keep both (a number is added). */
  conflict?: 'replace' | 'keep-both';
}

export type TransferResult = { path: string } | { conflict: string };

export interface ExportZipRequest {
  projectPath: string;
  includeHistory: boolean;
  outPath?: string;
}

export interface GuideInfo {
  kind: 'voice' | 'style';
  name: string;
  path: string;
}

export type AppEvent =
  | { type: 'library-changed' }
  | { type: 'ai-delta'; id: string; text: string }
  | { type: 'ai-done'; id: string; result: AiResult }
  | { type: 'ai-error'; id: string; message: string }
  | { type: 'files-changed'; paths: string[] }
  | { type: 'history-changed'; projectPath: string }
  | { type: 'menu'; command: MenuCommand };

export type MenuCommand =
  | 'toggle-preview'
  | 'new-file'
  | 'new-project'
  | 'new-collection'
  | 'new-project-from-template'
  | 'new-template'
  | 'export-pdf'
  | 'export-zip'
  | 'export-html'
  | 'checkpoint'
  | 'show-history'
  | 'convert-quotes'
  | 'find-in-library'
  | 'settings'
  | 'ai-command'
  | 'ai-chat'
  | 'ai-review'
  | 'insights'
  | 'toggle-authorship'
  | 'save'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'toggle-library'
  | 'find-replace'
  | 'replace-all'
  | 'select-all-occurrences'
  | 'select-next-occurrence'
  | 'new-tab'
  | 'close-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'format-bold'
  | 'format-italic'
  | 'format-mark';

export interface AppApi {
  app: {
    state(): Promise<AppState>;
    defaultLibraryPath(): Promise<string>;
    /** Opens (and when `create` is true, initialises) a library folder. */
    openLibrary(path: string, create: boolean): Promise<AppState>;
    chooseFolder(title: string): Promise<string | null>;
    /** Lets the user pick files to open; `extensions` limits the choice (without dots). */
    chooseFiles(title: string, extensions?: string[]): Promise<string[]>;
    setLastDocument(path: string | null): Promise<void>;
    setOpenTabs(tabs: OpenTabs): Promise<void>;
  };
  library: {
    tree(): Promise<LibraryTree>;
    createCollection(name: string): Promise<string>;
    createProject(req: { collection: string; name: string; template?: string }): Promise<string>;
    createTemplate(req: { name: string; fromProject?: string }): Promise<string>;
    rename(path: string, newName: string): Promise<string>;
    trash(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    /** Collections, projects, folders and files whose name or text matches the words of `query`. */
    search(query: string): Promise<LibrarySearchResult>;
  };
  project: {
    details(projectPath: string): Promise<ProjectDetails>;
    updateMeta(projectPath: string, patch: Partial<ProjectMeta>): Promise<ProjectMeta>;
    /** Project folder that contains `path`, or null. */
    projectFor(path: string): Promise<string | null>;
    /** Markdown files in the project (for export selection). */
    documents(projectPath: string): Promise<string[]>;
    /** PDF files in the project, with page counts (for inserting pages and arranging exports). */
    pdfs(projectPath: string): Promise<ProjectPdf[]>;
    /** Copies files into a folder of the project (created when missing); returns their paths. */
    importFiles(projectPath: string, sources: string[], folder: string): Promise<string[]>;
  };
  files: {
    readDocument(path: string): Promise<DocumentFile>;
    saveDocument(req: SaveDocumentRequest): Promise<{ mtimeMs: number }>;
    readText(path: string): Promise<string>;
    writeText(path: string, text: string): Promise<void>;
    createFile(dir: string, name: string, content?: string): Promise<string>;
    createFolder(dir: string, name: string): Promise<string>;
    /**
     * Moves or copies a file or folder into a project or a folder inside one. The source is a file or
     * folder inside a project, or one from outside the library (dropped from Finder). When the name is
     * taken and `conflict` is not given, nothing is done and the name is returned.
     */
    transfer(req: TransferRequest): Promise<TransferResult>;
  };
  themes: {
    list(projectPath?: string): Promise<ThemeInfo[]>;
    create(name: string, from?: string): Promise<ThemeInfo>;
    /** Copies a library theme into the project so it can be customised for that project only. */
    fork(projectPath: string, themeName: string): Promise<ThemeInfo>;
    /** Saves a library theme as a .mdtheme package (asks where); null when cancelled. */
    exportTheme(name: string, outPath?: string): Promise<{ path: string; fonts: ThemeFontReport; images: ThemeImageReport } | null>;
    /** Adds a theme from a .mdtheme package (asks for it when `source` is not given). */
    importTheme(source?: string): Promise<{ theme: ThemeInfo; fonts: ThemeFontReport; images: ThemeImageReport } | null>;
    /** Copies font files into a library theme with @font-face rules; returns the families added. */
    addFonts(name: string, sources?: string[]): Promise<string[]>;
    /** Copies image files into a library theme's images folder; returns their theme-relative paths. */
    addImages(name: string, sources?: string[]): Promise<string[]>;
    fontReport(name: string): Promise<ThemeFontReport>;
  };
  render: {
    document(req: RenderRequest): Promise<RenderResult>;
    /**
     * The components a document can insert: its theme's and the app's (the theme's win), with
     * their fields. `text` is the unsaved editor text (its front matter can choose the theme).
     */
    components(req: { docPath: string; text?: string }): Promise<{ theme: string | null; components: ComponentSpec[] }>;
  };
  /** Assistant conversations, one per project (or library folder), kept in its META_DIR. */
  chats: {
    load(rootPath: string): Promise<ChatTurn[]>;
    save(rootPath: string, turns: ChatTurn[]): Promise<void>;
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
    /**
     * Folder whose history covers `path`: its project or template, or the library's Themes or
     * Guides folder. The other history calls take this folder.
     */
    rootFor(path: string): Promise<{ path: string; name: string; kind: 'project' | 'library' } | null>;
  };
  exports: {
    pdf(req: ExportPdfRequest): Promise<{ path: string } | null>;
    zip(req: ExportZipRequest): Promise<{ path: string } | null>;
    /** One self-contained .html page (images and fonts embedded). */
    html(req: { docPath: string; outPath?: string }): Promise<{ path: string } | null>;
  };
  settings: {
    get(): Promise<Preferences>;
    update(patch: Partial<Preferences>): Promise<Preferences>;
  };
  ai: {
    /** Which providers have an API key stored. */
    keyStatus(): Promise<Record<string, boolean>>;
    setKey(providerId: string, key: string | null): Promise<void>;
    listModels(providerId: string): Promise<string[]>;
    test(providerId: string): Promise<{ ok: boolean; message: string }>;
    /** Starts a streamed request; progress arrives as ai-delta / ai-done / ai-error events. */
    start(req: AiRequest): Promise<{ id: string }>;
    cancel(id: string): Promise<void>;
    complete(req: AiRequest): Promise<AiResult>;
    logInsertion(entry: AiInsertion): Promise<void>;
    insertions(projectPath: string, limit?: number): Promise<AiInsertion[]>;
  };
  guides: {
    list(): Promise<GuideInfo[]>;
    create(kind: GuideInfo['kind'], name: string, from?: string): Promise<GuideInfo>;
  };
  references: {
    /** Files in the project's References folder plus any other included file. */
    list(projectPath: string): Promise<ReferenceInfo[]>;
    setIncluded(projectPath: string, path: string, included: boolean): Promise<void>;
    /** Copies files into the project's References folder and includes them; returns their paths. */
    add(projectPath: string, sources: string[]): Promise<string[]>;
  };
  tags: {
    /** Finder tag colours of the paths that have any. */
    get(paths: string[]): Promise<Record<string, TagColor[]>>;
    /** Switches a Finder tag colour on or off; returns the path's colours afterwards. */
    set(path: string, color: TagColor, on: boolean): Promise<TagColor[]>;
  };
  thesaurus: {
    /** Synonyms for a word or short phrase; null when it is not in the thesaurus. */
    lookup(word: string, options?: ThesaurusOptions): Promise<ThesaurusResult | null>;
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
    /** Opens the system emoji and symbols picker; false where there is none. */
    showEmojiPanel(): Promise<boolean>;
    /**
     * Starts dragging a file or folder of a project out of the app (to Finder), as a copy: the
     * library keeps its own. False where the host cannot (the iPad).
     */
    startDrag(path: string): Promise<boolean>;
  };
  events: {
    subscribe(listener: (e: AppEvent) => void): () => void;
  };
}

export interface LibrarySearchHit {
  path: string;
  kind: 'collection' | 'project' | 'folder' | 'file';
  collection: string;
  collectionPath: string;
  project?: string;
  projectPath?: string;
  /** Path inside the project, for folders and files. */
  rel?: string;
  /** The name itself matches (otherwise only the file's text does). */
  nameMatch: boolean;
  /** Lines that match, for files whose text matches. */
  lines?: Array<{ line: number; text: string }>;
}

export interface LibrarySearchResult {
  query: string;
  hits: LibrarySearchHit[];
  /** More matched than are listed. */
  truncated: boolean;
}

export interface ProjectPdf {
  path: string;
  /** Path relative to the project, with forward slashes. */
  rel: string;
  /** URL the renderer can load the file from. */
  url: string;
  pages?: number;
  /** Fonts without embedded programs (the export is then not marked PDF/UA). */
  unembeddedFonts?: boolean;
  /** Why the file cannot be inserted (encrypted, unreadable). */
  error?: string;
}

export interface ContextMenuItem {
  id?: string;
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  submenu?: ContextMenuItem[];
  /** Shown with a check mark. */
  checked?: boolean;
  /** A coloured dot shown before the label (CSS hex colour). */
  color?: string;
  /** Native edit action performed by the host instead of returning an id. */
  role?: 'cut' | 'copy' | 'paste' | 'selectAll';
}
