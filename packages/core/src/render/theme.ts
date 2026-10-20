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
figure.mde-figure img { display: block; max-width: 100%; }
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
