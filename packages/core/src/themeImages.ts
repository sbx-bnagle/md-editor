// Images in themes: which ones a theme's CSS and component templates refer to, and which of those
// the theme folder holds (so exports can include them, or say what they leave out).

import { normalize } from './paths';
import { isRelativeUrl } from './render/markdown';

/** Image formats a theme can package (those Chromium displays). */
export const THEME_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'];

const isImage = (path: string) => THEME_IMAGE_EXTENSIONS.includes(path.split('.').pop()!.toLowerCase());
const clean = (ref: string) => ref.trim().split(/[?#]/)[0];
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const withoutFontFaces = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '');

/** Relative image url() references in CSS (outside @font-face rules), as written, without query or fragment. */
export function cssImageRefs(css: string): string[] {
  const out = new Set<string>();
  for (const m of withoutFontFaces(css).matchAll(CSS_URL)) {
    const ref = clean(m[2]);
    if (isRelativeUrl(ref) && isImage(ref)) out.add(ref);
  }
  return [...out];
}

/** Literal paths given to the theme_url filter in a component template: {{ "images/logo.png" | theme_url }}. */
export function templateImageRefs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/(["'])([^"'{}]+)\1\s*\|\s*theme_url\b/g)) {
    const ref = clean(m[2]);
    if (isRelativeUrl(ref) && isImage(ref)) out.add(ref);
  }
  return [...out];
}

/**
 * Replaces relative url() references in CSS that `map` returns a new value for (outside
 * @font-face rules, whose sources are fonts).
 */
export function rewriteCssImageRefs(css: string, map: (ref: string) => string | null): string {
  const faces: Array<[number, number]> = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => [m.index!, m.index! + m[0].length]);
  return css.replace(CSS_URL, (whole, _q: string, url: string, at: number) => {
    if (faces.some(([a, b]) => at >= a && at < b)) return whole;
    const to = map(clean(url));
    return to === null ? whole : `url("${to}")`;
  });
}

/** Where a reference written in the theme points, relative to the theme folder ("../" when outside it). */
export function themeRelative(ref: string): string {
  return normalize(ref.replace(/^\.\//, ''));
}

export interface ThemeImageReport {
  /** Image files in the theme folder (relative paths). */
  packaged: string[];
  /** Images referred to inside the theme folder but not there. */
  missing: string[];
  /** Images referred to outside the theme folder, as written; they do not travel with the theme. */
  outside: string[];
  /** Export only: images from elsewhere in the library copied into the package's images folder. */
  copied?: string[];
}

/** `refs` come from cssImageRefs and templateImageRefs; `files` are the theme's files, relative, with forward slashes. */
export function themeImageReport(refs: string[], files: string[]): ThemeImageReport {
  const have = new Set(files.map((f) => f.toLowerCase()));
  const missing = new Set<string>();
  const outside = new Set<string>();
  for (const ref of refs) {
    const rel = themeRelative(ref);
    if (rel === '..' || rel.startsWith('../')) outside.add(ref);
    else if (!have.has(rel.toLowerCase())) missing.add(rel);
  }
  return { packaged: files.filter(isImage).sort(), missing: [...missing].sort(), outside: [...outside].sort() };
}
