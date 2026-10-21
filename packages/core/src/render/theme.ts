// Theme CSS processing.
//
// Themes are plain CSS using CSS Paged Media (@page, margin boxes, counter(page)).
// Document variables are available as custom properties: var(--title).
// Inside @page margin boxes, var(--name) in a `content:` declaration is rewritten to
// string(mde-var-name), so headers and footers follow per-section values set by
// transcluded documents. Elsewhere var(--name) is the root document's value.

import { join } from '../paths';
import { cssIdent, cssString } from '../variables';
import { isRelativeUrl } from './markdown';

/** App base styles, applied before the theme. */
export const BASE_CSS = `
@page { size: letter; margin: 1in; }
.mde-vars { display: none; }
.mde-missing {
  border: 1px dashed #c0392b; color: #c0392b; padding: 0.5em 0.75em; margin: 1em 0;
  font: 11px/1.4 -apple-system, system-ui, sans-serif;
}
img { max-width: 100%; }
figure.mde-figure { margin: 1em 0; }
/* A small image in a line of text (a logo): as tall as the capital letters. */
img.mde-inline-image { display: inline; height: 0.85em; width: auto; vertical-align: baseline; }
figure.mde-figure img { display: block; max-width: 100%; }
figure.mde-diagram { margin: 1em 0; break-inside: avoid; }
.mde-mermaid { break-inside: avoid; }
.mde-mermaid svg { display: block; max-width: 100%; max-height: 8in; height: auto; margin: 0 auto; }
.mde-diagram-source { white-space: pre-wrap; font-size: 0.85em; }
/* Inserted PDF pages: each on its own page without margins or running headers. */
@page mde-pdf {
  margin: 0;
  @top-left-corner { content: none; border: none; }
  @top-left { content: none; border: none; }
  @top-center { content: none; border: none; }
  @top-right { content: none; border: none; }
  @top-right-corner { content: none; border: none; }
  @right-top { content: none; border: none; }
  @right-middle { content: none; border: none; }
  @right-bottom { content: none; border: none; }
  @bottom-right-corner { content: none; border: none; }
  @bottom-right { content: none; border: none; }
  @bottom-center { content: none; border: none; }
  @bottom-left { content: none; border: none; }
  @bottom-left-corner { content: none; border: none; }
  @left-bottom { content: none; border: none; }
  @left-middle { content: none; border: none; }
  @left-top { content: none; border: none; }
}
.mde-pdf-insert { margin: 0; padding: 0; }
.mde-pdf-page {
  page: mde-pdf; break-before: page; break-after: page; margin: 0;
  width: 100%; height: calc(var(--pagedjs-pagebox-height, 11in) - 4px);
  display: flex; align-items: center; justify-content: center; background: #fff;
}
.mde-pdf-page img { max-width: 100%; max-height: 100%; display: block; }
`;

/** Finds the [start, end) ranges of every top-level @page block. */
function pageBlocks(css: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /@page\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const open = css.indexOf('{', m.index);
    if (open === -1) break;
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      const c = css[i];
      if (c === '"' || c === "'") {
        const close = css.indexOf(c, i + 1);
        i = close === -1 ? css.length : close;
      } else if (c === '/' && css[i + 1] === '*') {
        const close = css.indexOf('*/', i + 2);
        i = close === -1 ? css.length : close + 1;
      } else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    out.push([m.index, i + 1]);
    re.lastIndex = i + 1;
  }
  return out;
}

/** Replaces var(--known) calls (including nested fallbacks) with string(mde-var-known). */
function rewriteVarCalls(value: string, idents: Set<string>): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf('var(', i);
    if (start === -1) break;
    out += value.slice(i, start);
    let depth = 0;
    let end = start + 3;
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++;
      else if (value[end] === ')' && --depth === 0) break;
    }
    const inner = value.slice(start + 4, end);
    const m = /^\s*--([A-Za-z0-9_-]+)\s*(?:,([\s\S]*))?$/.exec(inner);
    if (m && idents.has(m[1])) out += `string(mde-var-${m[1]})`;
    else if (m && m[2] !== undefined) out += `var(--${m[1]},${rewriteVarCalls(m[2], idents)})`;
    else out += value.slice(start, end + 1);
    i = end + 1;
  }
  return out + value.slice(i);
}

/** Rewrites var(--name) to string(mde-var-name) in @page `content:` declarations. */
export function rewriteMarginBoxVariables(css: string, variableNames: Iterable<string>): string {
  const idents = new Set([...variableNames].map(cssIdent));
  const blocks = pageBlocks(css);
  if (blocks.length === 0) return css;
  let out = '';
  let last = 0;
  for (const [s, e] of blocks) {
    out += css.slice(last, s);
    out += css.slice(s, e).replace(/(content\s*:)([^;}]*)/gi, (_m, prop: string, value: string) => prop + rewriteVarCalls(value, idents));
    last = e;
  }
  return out + css.slice(last);
}

/** Rewrites relative url(...) references so theme assets load from the theme folder. */
export function rewriteCssUrls(css: string, baseDir: string, assetUrl: (abs: string) => string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q: string, url: string) => {
    if (!isRelativeUrl(url.trim())) return whole;
    return `url("${assetUrl(join(baseDir, url.trim()))}")`;
  });
}

/** Custom properties for root values plus string-set rules for per-section values. */
export function variableCss(rootScope: Record<string, string>, variableNames: Iterable<string>): string {
  const props = Object.entries(rootScope)
    .map(([k, v]) => `  --${cssIdent(k)}: ${cssString(v)};`)
    .join('\n');
  const sets = [...new Set([...variableNames].map(cssIdent))]
    .map((id) => `.mde-var[data-var="${id}"] { string-set: mde-var-${id} content(text); }`)
    .join('\n');
  return `:root {\n${props}\n}\n${sets}\n`;
}

export interface ThemeCssInput {
  themeCss: string;
  /** Absolute folder of theme.css. */
  themeDir: string;
  rootScope: Record<string, string>;
  variableNames: string[];
  assetUrl: (abs: string) => string;
}

/** Final stylesheet handed to the page renderer. */
export function buildDocumentCss(input: ThemeCssInput): string {
  const names = new Set([...input.variableNames, ...Object.keys(input.rootScope)]);
  const theme = rewriteMarginBoxVariables(rewriteCssUrls(input.themeCss, input.themeDir, input.assetUrl), names);
  return `${BASE_CSS}\n/* theme */\n${theme}\n/* variables */\n${variableCss(input.rootScope, names)}`;
}

const PAGE_SIZES: Record<string, [number, number]> = {
  letter: [8.5, 11],
  legal: [8.5, 14],
  ledger: [11, 17],
  tabloid: [11, 17],
  a3: [297 / 25.4, 420 / 25.4],
  a4: [210 / 25.4, 297 / 25.4],
  a5: [148 / 25.4, 210 / 25.4],
  b4: [250 / 25.4, 353 / 25.4],
  b5: [176 / 25.4, 250 / 25.4],
};
const UNIT_PX: Record<string, number> = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, px: 1, q: 96 / 101.6 };

function lengthPx(value: string): number | null {
  const m = /^(-?\d*\.?\d+)(in|cm|mm|pt|pc|px|q)?$/i.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] ? n * UNIT_PX[m[2].toLowerCase()] : n === 0 ? 0 : null;
}

/** Declarations directly inside plain `@page { … }` rules (not :first etc., not margin boxes), in order. */
function pageDeclarations(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /@page\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let current = '';
    for (; i < clean.length && depth > 0; i++) {
      const c = clean[i];
      if (c === '{') {
        depth++;
        current = '';
      } else if (c === '}') {
        depth--;
        current = '';
      } else if (depth === 1 && c === ';') {
        const colon = current.indexOf(':');
        if (colon > 0) out.push([current.slice(0, colon).trim().toLowerCase(), current.slice(colon + 1).trim()]);
        current = '';
      } else if (depth === 1) current += c;
    }
    const colon = current.indexOf(':');
    if (colon > 0) out.push([current.slice(0, colon).trim().toLowerCase(), current.slice(colon + 1).trim()]);
  }
  return out;
}

/** Width of the page's text area in CSS pixels, from the @page size and margins (default: US Letter, 1in margins). */
export function pageContentWidth(css: string): number {
  let width = 8.5 * 96;
  let left = 96;
  let right = 96;
  for (const [prop, value] of pageDeclarations(css)) {
    const parts = value.replace(/!important/, '').trim().split(/\s+/);
    if (prop === 'size') {
      const named = parts.find((p) => PAGE_SIZES[p.toLowerCase()]);
      const lengths = parts.map(lengthPx).filter((n): n is number => n !== null);
      let w: number | null = null;
      let h: number | null = null;
      if (named) [w, h] = PAGE_SIZES[named.toLowerCase()].map((n) => n * 96);
      else if (lengths.length) [w, h] = [lengths[0], lengths[1] ?? lengths[0]];
      if (w !== null && h !== null) width = parts.includes('landscape') ? Math.max(w, h) : parts.includes('portrait') ? Math.min(w, h) : w;
    } else if (prop === 'margin') {
      const v = parts.map(lengthPx);
      const r = v[1] ?? v[0];
      const l = v[3] ?? r;
      if (r !== null && r !== undefined) right = r;
      if (l !== null && l !== undefined) left = l;
    } else if (prop === 'margin-left' || prop === 'margin-right') {
      const v = lengthPx(parts[0]);
      if (v !== null) prop === 'margin-left' ? (left = v) : (right = v);
    }
  }
  return Math.max(96, Math.round(width - left - right));
}
