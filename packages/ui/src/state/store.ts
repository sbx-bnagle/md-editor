import { create } from 'zustand';
import type { AnnotationBlock, AppState, ChatTurn, GuideInfo, IncludeTagValue, LibraryTree, Preferences, LibrarySearchResult, ProjectDetails, ReferenceInfo, TagColor, RenderResult, ReviewGap, ReviewIssue, StyleGuide } from '@mde/core';

export type OpenKind = 'markdown' | 'css' | 'text' | 'image' | 'unsupported';

export interface OpenDoc {
  path: string;
  name: string;
  kind: OpenKind;
  /** Project or template folder; null for library themes. */
  projectPath: string | null;
  /** Theme folder name when editing a theme's CSS. */
  themeName?: string;
  mtimeMs: number;
  annotations: AnnotationBlock | null;
  annotationStatus: 'none' | 'valid' | 'invalid';
  /** Text loaded from disk; the editor resets to it when loadId changes. */
  initialText: string;
  loadId: number;
}

/** A tab in the workspace. `doc` is the document of the active tab; a null path is an empty tab. */
export interface DocTab {
  id: number;
  path: string | null;
}

/** Choosing and ordering pages of a PDF (for a content block or an export part). */
export interface PagePickerSpec {
  /** File name or description shown in the title. */
  name: string;
  url: string;
  count: number;
  /** Current selection; empty means every page. */
  pages: number[];
  onDone(pages: number[]): void;
}

/** Filling in a theme component's fields to insert (or change) its include tag. */
export interface ComponentDialogSpec {
  docPath: string;
  /** The tag under the cursor when changing one; null to insert a new tag. */
  editing: { name: string; values: Record<string, IncludeTagValue> } | null;
  /** The cursor's line is empty, so a new tag goes on its own line by default. */
  emptyLine: boolean;
  /** Puts the tag in the document: on a line of its own (a block) or in the text (inline). */
  onDone(tag: string, placement: 'line' | 'inline'): void;
}

/** Export PDF with an arrangement of PDF parts before and after the document. */
export interface ExportDialogSpec {
  projectPath: string;
  documents: string[];
  docPath: string;
}

export interface DialogField {
  name: string;
  label: string;
  type: 'text' | 'select' | 'checkbox' | 'radio';
  value: string | boolean;
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  help?: string;
  /** Only shown when another field has a given value. */
  showIf?: { field: string; equals: string | boolean };
}

export interface DialogSpec {
  title: string;
  message?: string;
  fields: DialogField[];
  okLabel: string;
  /** Returns an error message to keep the dialog open. */
  onSubmit(values: Record<string, string | boolean>): Promise<string | void>;
  /** Label of the button that closes the dialog (Cancel), and what else happens then. */
  cancelLabel?: string;
  onCancel?(): void;
  /** A third button, between Cancel and the main one; closes the dialog. */
  alt?: { label: string; onClick(): void };
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

export interface DiffTarget {
  projectPath: string;
  snapshotId: string;
  snapshotLabel: string;
  path: string;
  against: 'previous' | 'current';
}

export type PanelId = 'history' | 'assistant' | 'insights';

export interface ActiveGuides {
  voice: { name: string; path: string; text: string } | null;
  style: (StyleGuide & { path: string }) | null;
}

/** An Assistant conversation (ai/chat.ts), by the folder it is saved in. */
export interface ChatState {
  turns: ChatTurn[];
  loaded: boolean;
  /** A reply is streaming. */
  busy: boolean;
}

export interface ReviewState {
  docPath: string;
  running: boolean;
  issues: Array<ReviewIssue & { from: number; to: number }>;
  /** Requirements in the reference files the document does not address. */
  gaps?: ReviewGap[];
  error?: string;
  /** Issues whose quoted text could not be found. */
  unplaced: number;
}

export interface StoreState {
  app: AppState | null;
  booted: boolean;
  tree: LibraryTree | null;
  expanded: Record<string, boolean>;
  projects: Record<string, ProjectDetails>;
  selected: string | null;
  tabs: DocTab[];
  activeTab: number;
  doc: OpenDoc | null;
  dirty: boolean;
  saving: boolean;
  lastSaved: number | null;
  mode: 'edit' | 'preview';
  /** Markdown document used to preview themes while editing CSS. */
  previewDocPath: string | null;
  render: RenderResult | null;
  renderError: string | null;
  rendering: boolean;
  pageCount: number | null;
  /** Page at the top of the preview (1-based). */
  previewPage: number | null;
  /** A request to show a page; seq makes repeated requests for the same page distinct. */
  pageJump: { page: number; seq: number } | null;
  zoom: number;
  panel: PanelId | null;
  prefs: Preferences | null;
  keyStatus: Record<string, boolean>;
  guides: GuideInfo[];
  activeGuides: ActiveGuides;
  review: ReviewState | null;
  /** Reference files of the open document's project. */
  references: { projectPath: string | null; items: ReferenceInfo[]; loading: boolean };
  /** The ⌘K bar: the range it writes to (kept in step with edits) in the document it was opened in. */
  commandBar: { id: number; mode: 'generate' | 'rewrite'; from: number; to: number; docPath: string } | null;
  chats: Record<string, ChatState>;
  settingsOpen: boolean;
  voiceProposal: { path: string; current: string; proposed: string; added: number; removed: number } | null;
  issueCounts: { spelling: number; grammar: number; style: number; review: number };
  historyVersion: number;
  diff: DiffTarget | null;
  dialog: DialogSpec | null;
  pagePicker: PagePickerSpec | null;
  /** The sidebar search: while `query` is set, results replace the tree. */
  librarySearch: { query: string; result: LibrarySearchResult | null };
  /** Finder tag colours of library items, by path (only items that have tags). */
  tagColors: Record<string, TagColor[]>;
  exportDialog: ExportDialogSpec | null;
  componentDialog: ComponentDialogSpec | null;
  toasts: Toast[];
  stats: { words: number; chars: number };
  warningsOpen: boolean;
}

export const useStore = create<StoreState>(() => ({
  app: null,
  booted: false,
  tree: null,
  expanded: {},
  projects: {},
  selected: null,
  tabs: [{ id: 1, path: null }],
  activeTab: 1,
  doc: null,
  dirty: false,
  saving: false,
  lastSaved: null,
  mode: 'edit',
  previewDocPath: null,
  render: null,
  renderError: null,
  rendering: false,
  pageCount: null,
  previewPage: null,
  pageJump: null,
  zoom: 1,
  panel: null,
  prefs: null,
  keyStatus: {},
  guides: [],
  activeGuides: { voice: null, style: null },
  review: null,
  references: { projectPath: null, items: [], loading: false },
  commandBar: null,
  chats: {},
  settingsOpen: false,
  voiceProposal: null,
  issueCounts: { spelling: 0, grammar: 0, style: 0, review: 0 },
  historyVersion: 0,
  diff: null,
  dialog: null,
  pagePicker: null,
  librarySearch: { query: '', result: null },
  tagColors: {},
  exportDialog: null,
  componentDialog: null,
  toasts: [],
  stats: { words: 0, chars: 0 },
  warningsOpen: false,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, kind, message, action }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 4000);
}
