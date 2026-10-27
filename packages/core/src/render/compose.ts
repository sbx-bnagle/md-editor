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
import { cssIdent, flattenVariables, listVariables, substituteVariables, templateData, type TemplateValue, type VarScope } from '../variables';
import { createMarkdown, escapeHtml, highlightCode, resolveHtmlAssets, type MarkdownEnv } from './markdown';
import { diagramHtml, diagramInfo, diagramIsDescribed } from '../diagrams';
import { parsePageSpec, pdfInsertHtml } from '../pdf/pages';
import { findInlineIncludes, imagesWithoutAlt, parseIncludeArgs, parseIncludeLine, renderComponent, slugify, type IncludeTag } from '../components';
import { isClosingFence, openingFence } from '../fences';

export interface ComposeHost {
  /** Returns file text, or null when the file does not exist. */
  readText(absPath: string): Promise<string | null>;
  exists(absPath: string): Promise<boolean>;
  /** URL the preview/PDF renderer can load for a local file. */
  assetUrl(absPath: string): string;
  /** Page count of a PDF, or why it cannot be inserted (encrypted, damaged). */
  pdfInfo?(absPath: string): Promise<{ pages: number; unembeddedFonts?: boolean } | { error: string }>;
  /** A component template ("figure.html") from the theme or the app; null when there is none. */
  loadComponent?(name: string): Promise<string | null>;
  /** URL of a file in the theme folder (the theme_url filter). */
  themeUrl?(rel: string): string;
}

export type ComposeWarningKind =
  | 'missing-file'
  | 'cycle'
  | 'too-deep'
  | 'unsupported'
  | 'outside-project'
  | 'missing-variable'
  | 'front-matter'
  /** Something that makes the PDF harder to use with assistive technology. */
  | 'accessibility';

export interface ComposeWarning {
  kind: ComposeWarningKind;
  /** Set on the warning that the first heading is below level 1 (PDF export can tag headings from H1 instead). */
  code?: 'first-heading-level';
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
  /** Components shown on every page (theme default); front matter `page-includes` overrides. */
  pageIncludes?: string[];
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
  /** Components used, by template name (their CSS is added to the document). */
  components: string[];
  /** The first heading of the composed document, if any. */
  firstHeading?: { level: number; text: string };
}

let mdInstance: ReturnType<typeof createMarkdown> | null = null;
const markdownIt = () => (mdInstance ??= createMarkdown());

function markerHtml(changes: Record<string, string>): string {
  const names = Object.keys(changes);
  if (names.length === 0) return '';
  const spans = names
    .map((n) => `<span class="mde-var" data-var="${escapeHtml(cssIdent(n))}">${escapeHtml(changes[n])}</span>`)
    .join('');
  return `<div class="mde-vars" aria-hidden="true">${spans}</div>`;
}

const undescribedDiagram = (kind: string) =>
  `${kind} has no description for screen readers; add “accTitle:” and “accDescr:” lines to the diagram.`;

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
  // Front matter lists, kept as lists for component templates (the scopes hold them as joined text).
  type Lists = Record<string, TemplateValue[]>;
  let rootLists: Lists = {};
  let selection: ComposedDocument['selection'] = {};
  let lastHeading = 0;
  let firstHeading: ComposedDocument['firstHeading'];

  // Heading levels across the whole composed document: the PDF outline and tags follow them.
  const checkHeadings = (outline: NonNullable<MarkdownEnv['outline']>, source: string) => {
    for (const h of outline) {
      if (lastHeading === 0) firstHeading = { level: h.level, text: h.text };
      if (lastHeading === 0 && h.level > 1) {
        warnings.push({ kind: 'accessibility', code: 'first-heading-level', message: `The first heading (“${h.text}”) is level ${h.level}; start the document with a level 1 heading (#).`, source, line: h.line });
      } else if (lastHeading > 0 && h.level > lastHeading + 1) {
        warnings.push({ kind: 'accessibility', message: `Heading “${h.text}” skips from level ${lastHeading} to ${h.level}; use level ${lastHeading + 1} or lower.`, source, line: h.line });
      }
      lastHeading = h.level;
    }
  };

  const components = new Set<string>();

  // The lookup filter: front matter of <project>/<folder>/<slug>.md, read once per render.
  const lookups = new Map<string, Promise<Record<string, TemplateValue> | null>>();
  const lookupWarnings = new Set<string>();
  const lookupFile = async (folder: string, name: string, where: { source: string; line: number }): Promise<Record<string, TemplateValue> | null> => {
    const warn = (message: string) => {
      const key = `${where.source}:${where.line}:${message}`;
      if (lookupWarnings.has(key)) return;
      lookupWarnings.add(key);
      warnings.push({ kind: 'missing-file', message, ...where });
    };
    const dir = join(opts.projectRoot, folder);
    if (folder.startsWith('/') || dir === opts.projectRoot || !isInside(dir, opts.projectRoot)) {
      warn(`lookup: “${folder}” is not a folder in the project.`);
      return null;
    }
    const slug = slugify(name);
    if (!slug) return null;
    const file = join(dir, `${slug}.md`);
    let data = lookups.get(file);
    if (!data) {
      data = read(file).then((t) => (t === null ? null : templateData(splitFrontMatter(splitAnnotations(t).text).data)));
      lookups.set(file, data);
    }
    const found = await data;
    if (!found) warn(`“${name}” was not found: there is no ${relative(opts.projectRoot, file)} in the project.`);
    return found;
  };

  /**
   * Renders a component for a file. Returns HTML, or a box when the component is missing or its
   * template has an error (with a warning). A leading "/" in src means the document's folder, as
   * in content blocks.
   */
  const component = async (tag: IncludeTag, scope: Record<string, string>, lists: Lists, source: string, line: number, mode: 'block' | 'inline' | 'page'): Promise<string> => {
    const inline = mode === 'inline';
    const where = { source, line };
    const box = (message: string) => (inline ? `<span class="mde-missing" role="note">${escapeHtml(message)}</span>` : missingBox(message));
    const src = host.loadComponent ? await host.loadComponent(tag.name) : null;
    if (src === null) {
      warnings.push({ kind: 'missing-file', message: `Component “${tag.name}” is not in the theme or the app’s components.`, ...where });
      return box(`Component not found: ${tag.name}`);
    }
    components.add(tag.name);
    const env: MarkdownEnv = { baseDir: dirname(source), assetUrl: host.assetUrl, lineOffset: 0, sourceFile: source, slugs: new Map() };
    const params = parseIncludeArgs(substituteVariables(tag.args, scope).text, scope, lists);
    const r = await renderComponent(src, {
      include: params,
      vars: scope,
      lists,
      load: async (name) => {
        const t = host.loadComponent ? await host.loadComponent(name) : null;
        if (t !== null) components.add(name);
        return t;
      },
      markdownify: (text) => markdownIt().renderInline(text, env as unknown as Record<string, unknown>),
      themeUrl: host.themeUrl ?? ((rel) => rel),
      lookup: (folder, name) => lookupFile(folder, name, where),
    });
    if ('error' in r) {
      warnings.push({ kind: 'unsupported', message: `Component “${tag.name}”: ${r.error}`, ...where });
      return box(`${tag.name}: ${r.error}`);
    }
    const html = resolveHtmlAssets(r.html.replace(/(\s(?:src|poster)\s*=\s*["'])\/(?!\/)/g, '$1'), env);
    // Page-wide components are hidden from assistive technology, so their images are decoration.
    const missingAlt = mode === 'page' ? 0 : imagesWithoutAlt(html);
    if (missingAlt) warnings.push({ kind: 'accessibility', message: `Component “${tag.name}” shows an image without a description; give it alt text (for figure.html, an alt or caption parameter).`, ...where });
    return inline ? html.replace(/\s*\n\s*/g, ' ') : html;
  };

  const read = async (path: string) => {
    deps.add(path);
    if (opts.overrides && Object.prototype.hasOwnProperty.call(opts.overrides, path)) return opts.overrides[path];
    return host.readText(path);
  };

  async function renderFile(path: string, parentScope: Record<string, string>, stack: string[], parentLists: Lists = {}): Promise<string> {
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
    // A name this file sets to something else than a list is no longer the parent's list.
    const lists: Lists = { ...parentLists };
    for (const n of Object.keys(own)) delete lists[n];
    Object.assign(lists, listVariables(fm.data));
    if (stack.length === 1) {
      rootScope = scope;
      rootLists = lists;
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

    const flush = async (nextStart: number) => {
      if (chunk.length) {
        const sub = substituteVariables(chunk.join('\n'), scope);
        // Inline components; their HTML has no line breaks, so line numbers stay put.
        const found = findInlineIncludes(sub.text);
        if (found.length) {
          let text = '';
          let at = 0;
          for (const f of found) {
            const lineNo = fm.bodyLine + chunkStart + sub.text.slice(0, f.from).split('\n').length - 1;
            text += sub.text.slice(at, f.from) + (await component(f.tag, scope, lists, path, lineNo, 'inline'));
            at = f.to;
          }
          sub.text = text + sub.text.slice(at);
        }
        for (const name of sub.missing) {
          warnings.push({ kind: 'missing-variable', message: `Variable “${name}” is not defined.`, source: path, line: fm.bodyLine + chunkStart });
        }
        const env: MarkdownEnv = { baseDir, assetUrl: host.assetUrl, lineOffset: fm.bodyLine + chunkStart, sourceFile: path, slugs, outline: [], imagesWithoutAlt: [], undescribedDiagrams: [] };
        out += markdownIt().render(sub.text, env as unknown as Record<string, unknown>);
        checkHeadings(env.outline!, path);
        for (const d of env.undescribedDiagrams!) warnings.push({ kind: 'accessibility', message: undescribedDiagram(d.kind), source: path, line: d.line });
        for (const img of env.imagesWithoutAlt!) {
          warnings.push({ kind: 'accessibility', message: `Image “${basename(img.src.replace(/[?#].*$/, ''))}” has no description; write one inside the brackets: ![description](…).`, source: path, line: img.line });
        }
      }
      chunk = [];
      chunkStart = nextStart;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) {
        if (isClosingFence(line, fence)) fence = null;
        chunk.push(line);
        continue;
      }
      const opening = openingFence(line);
      if (opening) {
        fence = opening;
        chunk.push(line);
        continue;
      }
      const include = parseIncludeLine(line);
      if (include) {
        await flush(i + 1);
        const lineNo = fm.bodyLine + i;
        out += `<div class="mde-component" data-component="${escapeHtml(include.name)}" data-src-line="${lineNo}">${await component(include, scope, lists, path, lineNo, 'block')}</div>\n`;
        continue;
      }
      const block = parseContentBlock(line);
      if (!block) {
        chunk.push(line);
        continue;
      }
      await flush(i + 1);
      out += await renderBlock(block, path, scope, stack, fm.bodyLine + i, lists);
    }
    await flush(lines.length);
    return out;
  }

  async function renderBlock(
    block: ContentBlock,
    from: string,
    scope: Record<string, string>,
    stack: string[],
    line: number,
    lists: Lists,
  ): Promise<string> {
    const title = block.title ? escapeHtml(block.title) : '';
    const lineAttr = ` data-src-line="${line}"`;
    // role="group": the image inside is the Figure in the PDF tags; the wrapper only groups it with its caption.
    const figure = (src: string) => {
      if (!title) {
        warnings.push({ kind: 'accessibility', message: `Image “${block.target}” has no description; add one in quotes after the path: ${block.target} "Description".`, source: from, line });
      }
      return `<figure class="mde-figure" role="group"${lineAttr}><img src="${escapeHtml(src)}" alt="${title}">${title ? `<figcaption>${title}</figcaption>` : ''}</figure>\n`;
    };
    if (block.online) return figure(block.target);
    const target = join(dirname(from), block.target.replace(/^\//, ''));
    const where = { source: from, line };
    if (!isInside(target, opts.projectRoot)) {
      // Everything a document uses must live in its project, so history and ZIP exports are complete.
      warnings.push({ kind: 'outside-project', message: `“${block.target}” is outside the project folder and is not included.`, ...where });
      return missingBox(`Outside the project: ${block.target}`);
    }
    if (block.kind === 'unsupported') {
      deps.add(target);
      warnings.push({ kind: 'unsupported', message: `“${block.target}”: this file type cannot be embedded.`, ...where });
      return missingBox(`Cannot embed ${block.target}`);
    }
    if (block.kind === 'pdf') {
      deps.add(target);
      if (!(await host.exists(target))) {
        warnings.push({ kind: 'missing-file', message: `PDF not found: ${block.target}`, ...where });
        return missingBox(`PDF not found: ${block.target}`);
      }
      const info = host.pdfInfo ? await host.pdfInfo(target) : { error: 'PDF pages can only be inserted when exporting from the app.' };
      if ('error' in info) {
        warnings.push({ kind: 'unsupported', message: `“${block.target}”: ${info.error}`, ...where });
        return missingBox(`Cannot insert ${block.target}: ${info.error}`);
      }
      const selection = parsePageSpec(block.pages, info.pages);
      if (selection.error) warnings.push({ kind: 'unsupported', message: `“${block.target}” pages: ${selection.error} All pages are included.`, ...where });
      if (!block.title) {
        warnings.push({ kind: 'accessibility', message: `Inserted PDF “${block.target}” has no description; add one in quotes after the path: ${block.target} "Description".`, ...where });
      }
      if (info.unembeddedFonts) {
        warnings.push({ kind: 'accessibility', message: `“${block.target}” uses fonts that are not embedded in it; PDF/UA requires embedded fonts. Re-save it with fonts embedded, or the export is not marked PDF/UA.`, ...where });
      }
      return pdfInsertHtml({ file: relative(opts.projectRoot, target), src: host.assetUrl(target), pages: selection.pages, title: block.title, line });
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
      return figure(host.assetUrl(target));
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
      const cell = (c: string, tag: string) => `<${tag}>${markdownIt().renderInline(c.trim(), env as unknown as Record<string, unknown>)}</${tag}>`;
      return (
        `<table class="mde-table"${lineAttr}>` +
        (title ? `<caption>${title}</caption>` : '') +
        (head ? `<thead><tr>${head.map((c) => cell(c, 'th')).join('')}</tr></thead>` : '') +
        `<tbody>${body.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table>\n`
      );
    }
    if (block.kind === 'diagram') {
      const info = diagramInfo(text);
      if (!diagramIsDescribed(info, block.title ?? undefined)) warnings.push({ kind: 'accessibility', message: undescribedDiagram(info.kind), ...where });
      return diagramHtml(text.replace(/\n$/, ''), { line, caption: block.title ?? undefined });
    }
    if (block.kind === 'code') {
      const cls = block.language ? ` class="hljs language-${block.language}"` : ' class="hljs"';
      const caption = title ? `<figcaption>${title}</figcaption>` : '';
      return `<figure class="mde-code-block" role="group"${lineAttr}>${caption}<pre class="mde-code"><code${cls}>${highlightCode(text.replace(/\n$/, ''), block.language)}</code></pre></figure>\n`;
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
    const inner = await renderFile(target, scope, [...stack, target], lists);
    const rel = escapeHtml(relative(opts.projectRoot, target));
    return `<section class="mde-include" data-src-file="${escapeHtml(rel)}" data-name="${escapeHtml(basename(target))}"${lineAttr}>${markerHtml(changed)}${inner}</section>${markerHtml(restore)}\n`;
  }

  const body = await renderFile(opts.docPath, { ...opts.baseScope }, [opts.docPath]);

  // Page-wide components (a footer on every page): theme default, or front matter page-includes.
  const listed = Object.prototype.hasOwnProperty.call(rootScope, 'page-includes')
    ? rootScope['page-includes']
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && s !== 'none')
    : (opts.pageIncludes ?? []);
  let pageHtml = '';
  for (const name of listed) {
    const inner = await component({ name, args: '' }, rootScope, rootLists, opts.docPath, 0, 'page');
    const cls = name.replace(/\.html$/, '').replace(/[^\w-]+/g, '-');
    // Running content (headers, footers) is decoration for assistive technology, like page numbers.
    pageHtml += `<div class="mde-page-include mde-page-include-${cls}" aria-hidden="true">${inner}</div>\n`;
  }

  const html = `<article class="mde-document">${markerHtml(rootScope)}${pageHtml}${body}</article>`;
  return {
    html,
    rootScope,
    selection,
    variableNames: [...allNames],
    warnings,
    dependencies: [...deps],
    components: [...components],
    firstHeading,
  };
}
