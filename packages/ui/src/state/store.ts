import { create } from 'zustand';
import type { AnnotationBlock, AppState, GuideInfo, LibraryTree, Preferences, LibrarySearchResult, ProjectDetails, ReferenceInfo, TagColor, RenderResult, ReviewGap, ReviewIssue, StyleGuide } from '@mde/core';

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
  commandBar: { mode: 'generate' | 'rewrite'; from: number; to: number } | null;
  settingsOpen: boolean;
  voiceProposal: { current: string; proposed: string; added: number; removed: number } | null;
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
