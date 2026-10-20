// Library layout on disk (see docs/FILE-FORMATS.md).
//
// <Library>/
//   .mdeditor/library.json
//   Collections/<Collection>/<Project>/...
//   Templates/<Template>/...
//   Themes/<Theme>/theme.css
//   Guides/                       (voice and style guides, iteration 2)
//
// <Project>/.mdeditor/project.json   project settings
// <Project>/.mdeditor/history.mdh    version history (single file, sync-friendly)
// <Project>/.mdeditor/themes/<Theme>/theme.css   project-specific theme forks

import { extname } from './paths';

export const LIBRARY_DIRS = {
  collections: 'Collections',
  templates: 'Templates',
  themes: 'Themes',
  guides: 'Guides',
} as const;

/** Subfolders of Guides/. */
export const GUIDE_DIRS = { voice: 'Voices', style: 'Styles' } as const;

export const META_DIR = '.mdeditor';
export const AI_LOG_FILE = 'ai-log.jsonl';
export const LIBRARY_FILE = 'library.json';
export const PROJECT_FILE = 'project.json';
export const HISTORY_FILE = 'history.mdh';
export const PROJECT_THEMES_DIR = 'themes';
export const THEME_CSS = 'theme.css';
export const DEFAULT_THEME = 'Classic';

export const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt', '.text']);
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.tif', '.tiff']);
/** Image formats Chromium cannot display. */
export const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(['.tif', '.tiff']);
export const TABLE_EXTENSIONS = new Set(['.csv', '.tsv']);

export function isMarkdownFile(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(path));
}

export function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path));
}

/** Files and folders never shown in the library tree or stored in history. */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.') || name === 'Icon\r';
}

/** Returns an error message, or null when the name is usable as a Finder folder or file name. */
export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Name cannot be empty.';
  if (n !== name) return 'Name cannot start or end with spaces.';
  if (n.startsWith('.')) return 'Name cannot start with a period.';
  if (/[/:]/.test(n)) return 'Name cannot contain “/” or “:”.';
  if (n.length > 200) return 'Name is too long.';
  return null;
}

export interface ProjectMeta {
  format: 1;
  kind: 'project' | 'template';
  created: string;
  /** Library or project theme name. */
  theme?: string;
  /** Voice guide name (iteration 2). */
  voice?: string;
  /** Style guide name (iteration 2). */
  style?: string;
  /** Last document exported to PDF, relative to the project. */
  lastExport?: string;
}

export function defaultProjectMeta(kind: 'project' | 'template', now: Date): ProjectMeta {
  return { format: 1, kind, created: now.toISOString(), theme: DEFAULT_THEME };
}
