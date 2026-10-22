// Curly quotes and dashes. Straight quotes are kept inside HTML tags and comments
// (<a href="...">), code (spans, fenced and indented blocks), {{variables}}, {% components %},
// link destinations and titles, bare URLs, front matter, and content block lines, where they
// are syntax rather than prose. In prose, -- becomes an en dash and --- an em dash; lines made
// only of hyphens (front matter delimiters, rules, setext underlines) and table rows (any line
// with a |) keep their hyphens.

import { mapOutsideCodeSpans } from './variables';
import { isContentBlockLine } from './contentBlocks';
import { frontMatterRange } from './frontmatter';
import { isClosingFence, openingFence } from './fences';

export const QUOTES = { open2: '“', close2: '”', open1: '‘', close1: '’' } as const;

const OPENING_CONTEXT = /[\s([{“‘—–\-/ ]/;

/** Whether a quote after `before` (the text before it on its line) opens a quotation. */
function opensAfter(before: string): boolean {
  if (!before) return true;
  // Emphasis and mark markers: what comes before them decides (*"Hamlet"* opens, "*Hamlet*" closes).
  const markup = /[*_~=]+$/.exec(before);
  if (markup) return opensAfter(before.slice(0, markup.index));
  // A blockquote marker opens; after a tag, an opening tag is looked through and a closing tag closes.
  if (/^\s*(?:>\s*)+$/.test(before)) return true;
  const tag = /<(\/?)[A-Za-z][^<>]*>$/.exec(before);
  if (tag) return !tag[1] && opensAfter(before.slice(0, tag.index));
  return OPENING_CONTEXT.test(before[before.length - 1]);
}

/**
 * Returns the curly replacement for a typed straight quote, given the text before it on its line
 * (or just the character before it).
 */
export function curlyQuote(quote: '"' | "'", before: string | undefined): string {
  const prev = before?.[before.length - 1];
  // Right after an opening quote of the same kind, the quotation is empty: this one closes it.
  if (quote === '"' && prev === QUOTES.open2) return QUOTES.close2;
  if (quote === "'" && prev === QUOTES.open1) return QUOTES.close1;
  const opening = opensAfter(before ?? '');
  if (quote === '"') return opening ? QUOTES.open2 : QUOTES.close2;
  return opening ? QUOTES.open1 : QUOTES.close1;
}

export const DASHES = { en: '\u2013', em: '\u2014' } as const;

/** Lines whose hyphens are markdown syntax: rules, setext underlines, table separators. */
export function isDashSyntaxLine(line: string): boolean {
  return /^\s*-*\s*$/.test(line) || /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/.test(line) || /^\s*(?:-\s+){2,}-?\s*$/.test(line);
}

/** Lines that are (or are becoming) table rows: hyphens there are cell syntax or data. */
export function isTableLine(line: string): boolean {
  return line.includes('|');
}

/**
 * For a hyphen typed after `lineBefore` (with `lineAfter` following the cursor), returns the
 * replacement for the previous character plus the typed one: "-" + "-" -> en dash,
 * en dash + "-" -> em dash.
 */
export function smartDash(lineBefore: string, lineAfter = ''): string | null {
  if (isDashSyntaxLine(`${lineBefore}-`) || isTableLine(lineBefore + lineAfter)) return null;
  const prev = lineBefore[lineBefore.length - 1];
  if (prev === '-' && lineBefore[lineBefore.length - 2] !== '-') return DASHES.en;
  if (prev === DASHES.en) return DASHES.em;
  return null;
}

/** Replaces -- and --- in prose text (no markup inside). */
export function smartenDashes(text: string): string {
  return text.replace(/(^|[^-])---(?!-)/g, `$1${DASHES.em}`).replace(/(^|[^-])--(?!-)/g, `$1${DASHES.en}`);
}

/** True when the text before the cursor on this line ends inside an unclosed HTML tag. */
export function isInsideHtmlTag(lineBefore: string): boolean {
  const lt = lineBefore.lastIndexOf('<');
  if (lt === -1) return false;
  if (lineBefore.lastIndexOf('>') > lt) return false;
  return /[A-Za-z/!?]/.test(lineBefore[lt + 1] ?? '');
}

/** True when the text before the cursor ends inside an unclosed {{variable}} or {% component %}. */
export function isInsideVariable(lineBefore: string): boolean {
  const open = lineBefore.lastIndexOf('{{');
  const tag = lineBefore.lastIndexOf('{%');
  return (open !== -1 && lineBefore.lastIndexOf('}}') < open) || (tag !== -1 && lineBefore.lastIndexOf('%}') < tag);
}

/** True when the text before the cursor ends inside a link's destination or title: [text](here "or here"), or [id]: here. */
export function isInsideLinkTarget(lineBefore: string): boolean {
  if (/^ {0,3}\[[^\]]+\]:\s/.test(lineBefore)) return true;
  const open = lineBefore.lastIndexOf('](');
  return open !== -1 && linkTargetEnd(lineBefore, open + 2) === -1;
}

/** Index just past the ) that closes a link destination starting at `from`, or -1. A title in quotes may hold a ). */
function linkTargetEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (/\s/.test(text[i - 1] ?? '')) quote = c;
    } else if (c === ')') return i + 1;
  }
  return -1;
}

/** True when the text before the cursor on this line ends inside an unclosed `code span`. */
export function isInsideCodeSpan(lineBefore: string): boolean {
  let i = 0;
  while (i < lineBefore.length) {
    const tick = lineBefore.indexOf('`', i);
    if (tick === -1) return false;
    let run = 1;
    while (lineBefore[tick + run] === '`') run++;
    const ticks = '`'.repeat(run);
    let close = lineBefore.indexOf(ticks, tick + run);
    while (close !== -1 && lineBefore[close + run] === '`') close = lineBefore.indexOf(ticks, close + run + 1);
    if (close === -1) return true;
    i = close + run;
  }
  return false;
}

/** Where a span of syntax starting at `i` ends (the index after it), or -1 when none starts there. */
function syntaxSpanEnd(seg: string, i: number): number {
  const c = seg[i];
  if (c === '<' && /[A-Za-z/!?]/.test(seg[i + 1] ?? '')) {
    const comment = seg.startsWith('<!--', i);
    const close = comment ? seg.indexOf('-->', i + 4) : seg.indexOf('>', i);
    return close === -1 ? seg.length : close + (comment ? 3 : 1);
  }
  if (c === '{' && (seg[i + 1] === '{' || seg[i + 1] === '%')) {
    const end = seg.indexOf(seg[i + 1] === '{' ? '}}' : '%}', i + 2);
    return end === -1 ? seg.length : end + 2;
  }
  if (c === ']' && seg[i + 1] === '(') {
    const end = linkTargetEnd(seg, i + 2);
    return end === -1 ? seg.length : end;
  }
  if ((c === 'h' || c === 'f' || c === 'm') && !/[\p{L}\p{N}]/u.test(seg[i - 1] ?? '')) {
    const url = /^(?:https?|ftp|mailto):[^\s<>()]+/.exec(seg.slice(i, i + 2048));
    if (url) return i + url[0].length;
  }
  return -1;
}

function smartenSegment(seg: string, before: string, dashes = true): string {
  let out = '';
  let prose = '';
  const flush = () => {
    out += dashes ? smartenDashes(prose) : prose;
    prose = '';
  };
  for (let i = 0; i < seg.length; i++) {
    const end = syntaxSpanEnd(seg, i);
    if (end !== -1) {
      flush();
      out += seg.slice(i, end);
      i = end - 1;
      continue;
    }
    const c = seg[i];
    if (c === '"' || c === "'") {
      prose += curlyQuote(c, (before + out + prose).slice(-200));
      continue;
    }
    prose += c;
  }
  flush();
  return out;
}

const INDENTED = /^(?: {4}|\t)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * Converts straight quotes and double/triple hyphens in a block of markdown (used for
 * pasted text and the “Convert Quotes and Dashes” command). `atDocumentStart` enables
 * front matter detection.
 */
export function smartenMarkdown(text: string, atDocumentStart = false, before = ''): string {
  let start = 0;
  let prefix = '';
  if (atDocumentStart) {
    const fm = frontMatterRange(text);
    if (fm) {
      prefix = text.slice(0, fm[1]);
      start = fm[1];
    }
  }
  const lines = text.slice(start).split('\n');
  let fence: string | null = null;
  // An HTML comment or tag left open at the end of a line goes on into the next ones.
  let open: 'comment' | 'tag' | null = null;
  // Indented code follows a blank line (or more indented code), except in a list.
  let indentedCode = false;
  let lastText = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : null;
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }
    const opening = !open && openingFence(line);
    if (opening) {
      fence = opening;
      continue;
    }
    if (!line.trim()) {
      if (prevLine !== null && prevLine.trim() && !indentedCode) lastText = prevLine;
      continue;
    }
    if (!open && INDENTED.test(line) && (indentedCode || prevLine === null || !prevLine.trim()) && !LIST_ITEM.test(lastText) && (indentedCode || !INDENTED.test(lastText))) {
      indentedCode = true;
      continue;
    }
    indentedCode = false;
    lastText = line;
    let head = '';
    let body = line;
    if (open) {
      const end = open === 'comment' ? line.indexOf('-->') : line.indexOf('>');
      if (end === -1) continue;
      head = line.slice(0, end + (open === 'comment' ? 3 : 1));
      body = line.slice(head.length);
      open = null;
    }
    if (/<!--(?:(?!-->).)*$/.test(body)) open = 'comment';
    else if (isInsideHtmlTag(body)) open = 'tag';
    if (!/["']|--/.test(body) || isContentBlockLine(body) || isDashSyntaxLine(body) || /^ {0,3}\[[^\]]+\]:\s/.test(body)) continue;
    let done = i === 0 ? before + head : head;
    const dashes = !isTableLine(line);
    lines[i] =
      head +
      mapOutsideCodeSpans(body, (seg) => {
        const r = smartenSegment(seg, done, dashes);
        done += r;
        return r;
      });
  }
  return prefix + lines.join('\n');
}
