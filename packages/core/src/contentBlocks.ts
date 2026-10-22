// Content blocks (transclusion), following iA's Markdown Content Blocks spec v0.4
// (https://github.com/iainc/Markdown-Content-Blocks), extended to accept paths that
// start with ./ or ../ as iA Writer does when files are dragged in.
//
//   /Chapter 1.md
//   ../shared/intro.md
//   /Flowchart.png "Engineering Flowchart"
//   /Savings Account.csv 'Recent Transactions'
//   https://example.com/minard.jpg (Napoleon’s Russian campaign)
//   /forms/W-9.pdf#pages=1-2 "Form W-9"     PDF pages inserted into exports (an extension)
//
// Paths resolve relative to the folder of the document that contains the block.

import { dirname, extname, join } from './paths';
import { DIAGRAM_EXTENSIONS } from './diagrams';
import { IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, TABLE_EXTENSIONS } from './library';
import { languageForExtension } from './languages';

export type ContentBlockKind = 'markdown' | 'image' | 'table' | 'diagram' | 'pdf' | 'code' | 'unsupported';

export interface ContentBlock {
  /** Path as written (local) or URL (online image). */
  target: string;
  online: boolean;
  title: string | null;
  kind: ContentBlockKind;
  /** Highlight.js language for code blocks. */
  language?: string;
  /** PDF page selection from a #pages= fragment, e.g. "3,1-2". */
  pages?: string;
}

const TITLE = String.raw`(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\(((?:[^)\\]|\\.)*)\))`;
const LOCAL_RE = new RegExp(String.raw`^ {0,3}((?:\.\.?)?/(?!/)[^\t]*?\.[A-Za-z0-9]+)(#pages=[0-9,-]*)?(?:[ \t]+${TITLE})?[ \t]*$`);
const ONLINE_RE = new RegExp(
  String.raw`^ {0,3}(?:<(https?://[^\s<>]+?\.(?:png|jpe?g|gif|tiff?|svg|webp|avif)(?:\?[^\s<>#]*)?(?:#[^\s<>]*)?)>|(https?://[^\s]+?\.(?:png|jpe?g|gif|tiff?|svg|webp|avif)(?:\?\S*)?(?:#\S*)?))(?:[ \t]+${TITLE})?[ \t]*$`,
  'i',
);

function unescapeTitle(s: string | undefined): string | null {
  if (s === undefined) return null;
  return s.replace(/\\(.)/g, '$1');
}

function kindFor(path: string): Pick<ContentBlock, 'kind' | 'language'> {
  const ext = extname(path);
  if (MARKDOWN_EXTENSIONS.has(ext)) return { kind: 'markdown' };
  if (IMAGE_EXTENSIONS.has(ext)) return { kind: 'image' };
  if (TABLE_EXTENSIONS.has(ext)) return { kind: 'table' };
  if (DIAGRAM_EXTENSIONS.has(ext)) return { kind: 'diagram' };
  if (ext === '.pdf') return { kind: 'pdf' };
  const language = languageForExtension(ext);
  if (language) return { kind: 'code', language };
  return { kind: 'unsupported' };
}

/** Parses one line. Returns null when the line is not a content block. */
/** Longer lines are prose: a path and title are never this long, and the patterns slow down on very long lines. */
const MAX_BLOCK_LINE = 2048;

export function parseContentBlock(line: string): ContentBlock | null {
  if (line.length === 0 || line.length > MAX_BLOCK_LINE) return null;
  const first = line.trimStart()[0];
  if (first === '/' || first === '.') {
    const m = LOCAL_RE.exec(line);
    if (!m) return null;
    const target = m[1].trimEnd();
    if (target.split('/').some((c, i) => i > 0 && c === '')) return null;
    const block: ContentBlock = { target, online: false, title: unescapeTitle(m[3] ?? m[4] ?? m[5]), ...kindFor(target) };
    if (m[2] && block.kind === 'pdf') block.pages = m[2].slice('#pages='.length);
    return block;
  }
  if (first === 'h' || first === 'H' || first === '<') {
    const m = ONLINE_RE.exec(line);
    if (!m) return null;
    const target = m[1] ?? m[2];
    return { target, online: true, title: unescapeTitle(m[3] ?? m[4] ?? m[5]), kind: 'image' };
  }
  return null;
}

/** Quick check used by the editor to style content block lines. */
export function isContentBlockLine(line: string): boolean {
  return parseContentBlock(line) !== null;
}

/** Absolute path of a local content block's target ("/x" and "x" are relative to the document's folder). */
export function contentBlockPath(docPath: string, target: string): string {
  return join(dirname(docPath), target.replace(/^\//, ''));
}

/** Writes a PDF content block line, e.g. /forms/w9.pdf#pages=3,1-2 "W-9 form". */
export function pdfBlockLine(target: string, pages: string, title: string | null): string {
  const t = title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : '';
  return `${target}${pages ? `#pages=${pages}` : ''}${t}`;
}
