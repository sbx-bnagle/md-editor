// Content blocks (transclusion), following iA's Markdown Content Blocks spec v0.4
// (https://github.com/iainc/Markdown-Content-Blocks), extended to accept paths that
// start with ./ or ../ as iA Writer does when files are dragged in.
//
//   /Chapter 1.md
//   ../shared/intro.md
//   /Flowchart.png "Engineering Flowchart"
//   /Savings Account.csv 'Recent Transactions'
//   https://example.com/minard.jpg (Napoleon’s Russian campaign)
//
// Paths resolve relative to the folder of the document that contains the block.

import { extname } from './paths';
import { IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, TABLE_EXTENSIONS } from './library';
import { languageForExtension } from './languages';

export type ContentBlockKind = 'markdown' | 'image' | 'table' | 'code' | 'unsupported';

export interface ContentBlock {
  /** Path as written (local) or URL (online image). */
  target: string;
  online: boolean;
  title: string | null;
  kind: ContentBlockKind;
  /** Highlight.js language for code blocks. */
  language?: string;
}

const TITLE = String.raw`(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\(((?:[^)\\]|\\.)*)\))`;
const LOCAL_RE = new RegExp(String.raw`^ {0,3}((?:\.\.?)?/(?!/)[^\t]*?\.[A-Za-z0-9]+)(?:[ \t]+${TITLE})?[ \t]*$`);
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
  const language = languageForExtension(ext);
  if (language) return { kind: 'code', language };
  return { kind: 'unsupported' };
}

/** Parses one line. Returns null when the line is not a content block. */
export function parseContentBlock(line: string): ContentBlock | null {
  if (line.length === 0) return null;
  const first = line.trimStart()[0];
  if (first === '/' || first === '.') {
    const m = LOCAL_RE.exec(line);
    if (!m) return null;
    const target = m[1].trimEnd();
    if (target.split('/').some((c, i) => i > 0 && c === '')) return null;
    return { target, online: false, title: unescapeTitle(m[2] ?? m[3] ?? m[4]), ...kindFor(target) };
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
