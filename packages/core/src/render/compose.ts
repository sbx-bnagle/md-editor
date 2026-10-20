// Composes a document and its content blocks (transclusions) into one HTML fragment.
//
// Each markdown file is rendered separately with its own variable scope: the parent's
// variables plus the file's own front matter (child values override locally). Hidden
// marker elements record scope changes so themes can show per-section values in page
// headers and footers via CSS string-set (see theme.ts).

import { splitAnnotations } from '../annotations';
import { parseContentBlock, type ContentBlock } from '../contentBlocks';
import { parseCsv } from '../csv';
import { splitFrontMatter } from '../frontmatter';
import { basename, dirname, extname, isInside, join, relative } from '../paths';
import { UNSUPPORTED_IMAGE_EXTENSIONS } from '../library';
import { cssIdent, flattenVariables, substituteVariables, type VarScope } from '../variables';
import { createMarkdown, escapeHtml, highlightCode, type MarkdownEnv } from './markdown';

export interface ComposeHost {
  /** Returns file text, or null when the file does not exist. */
  readText(absPath: string): Promise<string | null>;
  exists(absPath: string): Promise<boolean>;
  /** URL the preview/PDF renderer can load for a local file. */
  assetUrl(absPath: string): string;
}

export type ComposeWarningKind =
  | 'missing-file'
  | 'cycle'
  | 'too-deep'
  | 'unsupported'
  | 'outside-project'
  | 'missing-variable'
  | 'front-matter';

export interface ComposeWarning {
  kind: ComposeWarningKind;
  message: string;
  /** Absolute path of the file containing the problem. */
  source: string;
  /** Zero-based line in that file. */
  line?: number;
}

export interface ComposeOptions {
  docPath: string;
  projectRoot: string;
  /** Variables available before the root document's front matter (built-ins). */
  baseScope: VarScope;
  /** Unsaved editor buffers by absolute path. */
  overrides?: Record<string, string>;
  maxDepth?: number;
}

export interface ComposedDocument {
  html: string;
  /** Root document scope (built-ins + root front matter). */
  rootScope: Record<string, string>;
  /** Root document front matter selections. */
  selection: { theme?: string; voice?: string; style?: string };
  /** Every variable name defined anywhere in the tree. */
  variableNames: string[];
  warnings: ComposeWarning[];
  /** Absolute paths of every file read or referenced. */
  dependencies: string[];
}

const md = createMarkdown();

function markerHtml(changes: Record<string, string>): string {
  const names = Object.keys(changes);
  if (names.length === 0) return '';
  const spans = names
    .map((n) => `<span class="mde-var" data-var="${escapeHtml(cssIdent(n))}">${escapeHtml(changes[n])}</span>`)
    .join('');
  return `<div class="mde-vars" aria-hidden="true">${spans}</div>`;
}

function missingBox(message: string): string {
  return `<div class="mde-missing" role="note">${escapeHtml(message)}</div>`;
}

export async function composeDocument(host: ComposeHost, opts: ComposeOptions): Promise<ComposedDocument> {
  const warnings: ComposeWarning[] = [];
  const deps = new Set<string>();
  const allNames = new Set<string>(Object.keys(opts.baseScope));
  const slugs = new Map<string, number>();
  const maxDepth = opts.maxDepth ?? 16;
  let rootScope: Record<string, string> = { ...opts.baseScope };
  let selection: ComposedDocument['selection'] = {};

  const read = async (path: string) => {
    deps.add(path);
    if (opts.overrides && Object.prototype.hasOwnProperty.call(opts.overrides, path)) return opts.overrides[path];
    return host.readText(path);
  };

  async function renderFile(path: string, parentScope: Record<string, string>, stack: string[]): Promise<string> {
    const raw = await read(path);
    if (raw === null) {
      if (stack.length === 1) warnings.push({ kind: 'missing-file', message: `File not found: ${basename(path)}`, source: path });
      return '';
    }
    const { text } = splitAnnotations(raw);
    const fm = splitFrontMatter(text);
    if (fm.error) warnings.push({ kind: 'front-matter', message: `Front matter: ${fm.error}`, source: path, line: 0 });
    const own = flattenVariables(fm.data);
    for (const n of Object.keys(own)) allNames.add(n);
    const scope = { ...parentScope, ...own };
    if (stack.length === 1) {
      rootScope = scope;
      selection = {
        theme: typeof fm.data.theme === 'string' ? fm.data.theme : undefined,
        voice: typeof fm.data.voice === 'string' ? fm.data.voice : undefined,
        style: typeof fm.data.style === 'string' ? fm.data.style : undefined,
      };
    }

    const lines = fm.body.split('\n');
    const baseDir = dirname(path);
    let out = '';
    let chunk: string[] = [];
    let chunkStart = 0;
    let fence: string | null = null;

    const flush = (nextStart: number) => {
      if (chunk.length) {
        const sub = substituteVariables(chunk.join('\n'), scope);
        for (const name of sub.missing) {
          warnings.push({ kind: 'missing-variable', message: `Variable “${name}” is not defined.`, source: path, line: fm.bodyLine + chunkStart });
        }
        const env: MarkdownEnv = { baseDir, assetUrl: host.assetUrl, lineOffset: fm.bodyLine + chunkStart, sourceFile: path, slugs };
        out += md.render(sub.text, env as unknown as Record<string, unknown>);
      }
      chunk = [];
      chunkStart = nextStart;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
        chunk.push(line);
        continue;
      }
      if (fenceMatch) {
        fence = fenceMatch[1];
        chunk.push(line);
        continue;
      }
      const block = parseContentBlock(line);
      if (!block) {
        chunk.push(line);
        continue;
      }
      flush(i + 1);
      out += await renderBlock(block, path, scope, stack, fm.bodyLine + i);
    }
    flush(lines.length);
    return out;
  }

  async function renderBlock(
    block: ContentBlock,
    from: string,
    scope: Record<string, string>,
    stack: string[],
    line: number,
  ): Promise<string> {
    const title = block.title ? escapeHtml(block.title) : '';
    const lineAttr = ` data-src-line="${line}"`;
    if (block.online) {
      return `<figure class="mde-figure"${lineAttr}><img src="${escapeHtml(block.target)}" alt="${title}">${title ? `<figcaption>${title}</figcaption>` : ''}</figure>\n`;
    }
    const target = join(dirname(from), block.target.replace(/^\//, ''));
    const where = { source: from, line };
    if (!isInside(target, opts.projectRoot)) {
      warnings.push({ kind: 'outside-project', message: `“${block.target}” is outside the project folder; it is not versioned or included in ZIP exports.`, ...where });
    }
    if (block.kind === 'unsupported') {
      deps.add(target);
      warnings.push({ kind: 'unsupported', message: `“${block.target}”: this file type cannot be embedded.`, ...where });
      return missingBox(`Cannot embed ${block.target}`);
    }
    if (block.kind === 'image') {
      deps.add(target);
      if (!(await host.exists(target))) {
        warnings.push({ kind: 'missing-file', message: `Image not found: ${block.target}`, ...where });
        return missingBox(`Image not found: ${block.target}`);
      }
      if (UNSUPPORTED_IMAGE_EXTENSIONS.has(extname(target))) {
        warnings.push({ kind: 'unsupported', message: `“${block.target}”: TIFF images cannot be displayed; convert to PNG or JPEG.`, ...where });
      }
      return `<figure class="mde-figure"${lineAttr}><img src="${escapeHtml(host.assetUrl(target))}" alt="${title}">${title ? `<figcaption>${title}</figcaption>` : ''}</figure>\n`;
    }

    if (stack.includes(target)) {
      warnings.push({ kind: 'cycle', message: `“${block.target}” includes itself (directly or through another file).`, ...where });
      return missingBox(`Circular include: ${block.target}`);
    }
    if (stack.length >= maxDepth) {
      warnings.push({ kind: 'too-deep', message: `Includes are nested more than ${maxDepth} levels deep.`, ...where });
      return missingBox(`Too deeply nested: ${block.target}`);
    }
    const text = await read(target);
    if (text === null) {
      warnings.push({ kind: 'missing-file', message: `File not found: ${block.target}`, ...where });
      return missingBox(`File not found: ${block.target}`);
    }

    if (block.kind === 'table') {
      const rows = parseCsv(text, extname(target) === '.tsv' ? '\t' : undefined);
      const [head, ...body] = rows;
      const env: MarkdownEnv = { baseDir: dirname(target), assetUrl: host.assetUrl, lineOffset: 0, sourceFile: target, slugs };
      const cell = (c: string, tag: string) => `<${tag}>${md.renderInline(c.trim(), env as unknown as Record<string, unknown>)}</${tag}>`;
      return (
        `<table class="mde-table"${lineAttr}>` +
        (title ? `<caption>${title}</caption>` : '') +
        (head ? `<thead><tr>${head.map((c) => cell(c, 'th')).join('')}</tr></thead>` : '') +
        `<tbody>${body.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table>\n`
      );
    }
    if (block.kind === 'code') {
      const cls = block.language ? ` class="hljs language-${block.language}"` : ' class="hljs"';
      const caption = title ? `<figcaption>${title}</figcaption>` : '';
      return `<figure class="mde-code-block"${lineAttr}>${caption}<pre class="mde-code"><code${cls}>${highlightCode(text.replace(/\n$/, ''), block.language)}</code></pre></figure>\n`;
    }

    // Markdown / text: render with an inherited scope and emit scope markers.
    const childOwn = flattenVariables(splitFrontMatter(splitAnnotations(text).text).data);
    const changed: Record<string, string> = {};
    const restore: Record<string, string> = {};
    for (const [k, v] of Object.entries(childOwn)) {
      if (scope[k] !== v) {
        changed[k] = v;
        restore[k] = scope[k] ?? '';
      }
    }
    const inner = await renderFile(target, scope, [...stack, target]);
    const rel = escapeHtml(relative(opts.projectRoot, target));
    return `<section class="mde-include" data-src-file="${rel}" data-name="${escapeHtml(basename(target))}"${lineAttr}>${markerHtml(changed)}${inner}</section>${markerHtml(restore)}\n`;
  }

  const body = await renderFile(opts.docPath, { ...opts.baseScope }, [opts.docPath]);

  const html = `<article class="mde-document">${markerHtml(rootScope)}${body}</article>`;
  return {
    html,
    rootScope,
    selection,
    variableNames: [...allNames],
    warnings,
    dependencies: [...deps],
  };
}
