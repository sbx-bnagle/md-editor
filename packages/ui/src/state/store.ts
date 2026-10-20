import { create } from 'zustand';
import type { AnnotationBlock, AppState, LibraryTree, ProjectDetails, RenderResult } from '@mde/core';

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

export interface StoreState {
  app: AppState | null;
  booted: boolean;
  tree: LibraryTree | null;
  expanded: Record<string, boolean>;
  projects: Record<string, ProjectDetails>;
  selected: string | null;
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
  zoom: number;
  historyOpen: boolean;
  historyVersion: number;
  diff: DiffTarget | null;
  dialog: DialogSpec | null;
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
  zoom: 1,
  historyOpen: false,
  historyVersion: 0,
  diff: null,
  dialog: null,
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
