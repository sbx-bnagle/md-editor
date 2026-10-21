import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js/lib/common';
import { join } from '../paths';
import { smartenDashes } from '../smartQuotes';
import { diagramHtml, diagramInfo, diagramIsDescribed } from '../diagrams';

export interface MarkdownEnv {
  /** Absolute folder of the document being rendered; relative image paths resolve here. */
  baseDir: string;
  assetUrl: (absPath: string) => string;
  /** Added to token line numbers so data-src-line refers to the original file. */
  lineOffset: number;
  /** Absolute path of the source file, written to data-src-file for preview editing. */
  sourceFile: string;
  /** Shared across a composed document so heading ids stay unique. */
  slugs: Map<string, number>;
  /** Filled while rendering: headings and images without alt text, with file line numbers. */
  outline?: Array<{ level: number; line: number; text: string }>;
  imagesWithoutAlt?: Array<{ src: string; line: number }>;
  undescribedDiagrams?: Array<{ kind: string; line: number }>;
}

const isMermaid = (info: string) => info.trim().split(/\s+/)[0]?.toLowerCase() === 'mermaid';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function isRelativeUrl(url: string): boolean {
  return !!url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url);
}

export function resolveAsset(src: string, env: MarkdownEnv): string {
  if (!isRelativeUrl(src)) return src;
  let path = src;
  try {
    path = decodeURI(src);
  } catch {
    // keep as written
  }
  return env.assetUrl(join(env.baseDir, path));
}

/** Resolves relative src/poster URLs of images and media in raw HTML against the document folder. */
export function resolveHtmlAssets(html: string, env: MarkdownEnv): string {
  return html.replace(SRC_ATTR, (_m, pre: string, q: string, url: string) => `${pre}${q}${escapeHtml(resolveAsset(url, env))}${q}`);
}

export function slugify(text: string, slugs: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
  const n = slugs.get(base) ?? 0;
  slugs.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

export function highlightCode(code: string, language: string | undefined): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      // fall through
    }
  }
  return escapeHtml(code);
}

const SRC_ATTR = /(<(?:img|source|video|audio)\b[^>]*?\s(?:src|poster)\s*=\s*)(["'])([^"']*)\2/gi;

const LINE_TAGGED = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'list_item_open',
  'table_open',
  'tr_open',
  'fence',
  'code_block',
  'hr',
  'html_block',
]);

export type Markdown = InstanceType<typeof MarkdownIt>;

const envOf = (env: unknown) => env as MarkdownEnv;

export function createMarkdown(): Markdown {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight: (code, lang) => {
      const language = lang || undefined;
      const cls = language ? ` class="hljs language-${escapeHtml(language)}"` : ' class="hljs"';
      return `<pre class="mde-code"><code${cls}>${highlightCode(code, language)}</code></pre>`;
    },
  });
  md.use(footnote);

  // Source line attributes (used for scroll sync and, later, preview editing).
  md.core.ruler.push('mde_lines', (state) => {
    const env = envOf(state.env);
    for (const token of state.tokens) {
      if (token.map && LINE_TAGGED.has(token.type)) {
        token.attrSet('data-src-line', String(token.map[0] + (env.lineOffset ?? 0)));
      }
    }
  });

  // -- and --- in prose become en and em dashes, also in files written in other editors.
  // Code spans, code blocks and raw HTML are separate tokens and are not touched.
  md.core.ruler.push('mde_dashes', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      for (const t of block.children) if (t.type === 'text' && t.content.includes('--')) t.content = smartenDashes(t.content);
    }
  });

  // Heading ids for internal links and the PDF outline.
  md.core.ruler.push('mde_heading_ids', (state) => {
    const env = envOf(state.env);
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_open' && !tokens[i].attrGet('id')) {
        const inline = tokens[i + 1];
        const text = inline?.children?.filter((t) => t.type === 'text' || t.type === 'code_inline').map((t) => t.content).join('') ?? '';
        tokens[i].attrSet('id', slugify(text, env.slugs ?? new Map()));
      }
    }
  });

  // Collects what the accessibility check needs: heading levels and images without alt text.
  md.core.ruler.push('mde_accessibility', (state) => {
    const env = envOf(state.env);
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const line = (t.map?.[0] ?? 0) + (env.lineOffset ?? 0);
      if (t.type === 'heading_open' && env.outline) {
        env.outline.push({ level: Number(t.tag.slice(1)), line, text: tokens[i + 1]?.content ?? '' });
      }
      if (t.type === 'fence' && isMermaid(t.info) && env.undescribedDiagrams) {
        const info = diagramInfo(t.content);
        if (!diagramIsDescribed(info)) env.undescribedDiagrams.push({ kind: info.kind, line });
      }
      if (t.type === 'inline' && t.children && env.imagesWithoutAlt) {
        for (const c of t.children) if (c.type === 'image' && !c.content.trim()) env.imagesWithoutAlt.push({ src: String(c.attrGet('src') ?? ''), line });
      }
    }
  });

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    if (src) token.attrSet('src', resolveAsset(String(src), envOf(env)));
    return defaultImage(tokens, idx, options, env, self);
  };

  const rewriteHtml = resolveHtmlAssets;
  const defaultHtmlBlock = md.renderer.rules.html_block!;
  md.renderer.rules.html_block = (tokens, idx, options, env, self) =>
    rewriteHtml(defaultHtmlBlock(tokens, idx, options, env, self), envOf(env));
  const defaultHtmlInline = md.renderer.rules.html_inline!;
  md.renderer.rules.html_inline = (tokens, idx, options, env, self) =>
    rewriteHtml(defaultHtmlInline(tokens, idx, options, env, self), envOf(env));

  // Fences keep their data-src-line attribute; ```mermaid fences become diagrams.
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    if (isMermaid(tokens[idx].info)) {
      const line = tokens[idx].attrGet('data-src-line');
      return diagramHtml(tokens[idx].content, { line: line ? Number(line) : undefined });
    }
    const out = defaultFence(tokens, idx, options, env, self);
    const line = tokens[idx].attrGet('data-src-line');
    return line ? out.replace(/^<pre/, `<pre data-src-line="${line}"`) : out;
  };

  return md;
}
