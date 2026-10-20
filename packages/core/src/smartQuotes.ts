// Curly quotes and dashes. Straight quotes are kept inside HTML tags (<a href="...">),
// code spans, fenced code, {{variables}}, front matter, and content block lines, where
// they are syntax rather than prose. In prose, -- becomes an en dash and --- an em dash;
// lines made only of hyphens (front matter delimiters, rules, setext underlines) and
// table separator rows are left alone.

import { mapOutsideCodeSpans } from './variables';
import { isContentBlockLine } from './contentBlocks';
import { frontMatterRange } from './frontmatter';

export const QUOTES = { open2: '“', close2: '”', open1: '‘', close1: '’' } as const;

const OPENING_CONTEXT = /[\s([{“‘—–\-/>*_ ]/;

/** Returns the curly replacement for a typed straight quote, given the character before it. */
export function curlyQuote(quote: '"' | "'", prev: string | undefined): string {
  const opening = !prev || OPENING_CONTEXT.test(prev);
  if (quote === '"') return opening ? QUOTES.open2 : QUOTES.close2;
  return opening ? QUOTES.open1 : QUOTES.close1;
}

export const DASHES = { en: '\u2013', em: '\u2014' } as const;

/** Lines whose hyphens are markdown syntax: rules, setext underlines, table separators. */
export function isDashSyntaxLine(line: string): boolean {
  return /^\s*-*\s*$/.test(line) || /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/.test(line) || /^\s*(?:-\s+){2,}-?\s*$/.test(line);
}

/**
 * For a hyphen typed after `lineBefore`, returns the replacement for the previous
 * character plus the typed one: "-" + "-" -> en dash, en dash + "-" -> em dash.
 */
export function smartDash(lineBefore: string): string | null {
  if (isDashSyntaxLine(`${lineBefore}-`)) return null;
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

/** True when the text before the cursor ends inside an unclosed {{variable}}. */
export function isInsideVariable(lineBefore: string): boolean {
  const open = lineBefore.lastIndexOf('{{');
  return open !== -1 && lineBefore.lastIndexOf('}}') < open;
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

function smartenSegment(seg: string, prevChar: string | undefined): string {
  let out = '';
  let prose = '';
  let inTag = false;
  let inVar = false;
  let prev = prevChar;
  const flush = () => {
    out += smartenDashes(prose);
    prose = '';
  };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (!inTag && !inVar && c === '<' && /[A-Za-z/!?]/.test(seg[i + 1] ?? '')) {
      flush();
      inTag = true;
    } else if (inTag && c === '>') inTag = false;
    else if (!inTag && !inVar && c === '{' && seg[i + 1] === '{') {
      flush();
      inVar = true;
    } else if (inVar && c === '}' && seg[i + 1] === '}') inVar = false;
    if (inTag || inVar || c === '>' || c === '}') {
      flush();
      out += c;
      prev = c;
      continue;
    }
    if (c === '"' || c === "'") {
      const r = curlyQuote(c, prev);
      prose += r;
      prev = r;
      continue;
    }
    prose += c;
    prev = c;
  }
  flush();
  return out;
}

/**
 * Converts straight quotes and double/triple hyphens in a block of markdown (used for
 * pasted text and the “Convert Quotes and Dashes” command). `atDocumentStart` enables
 * front matter detection.
 */
export function smartenMarkdown(text: string, atDocumentStart = false): string {
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    if (!/["']|--/.test(line) || isContentBlockLine(line) || isDashSyntaxLine(line)) continue;
    let last: string | undefined;
    lines[i] = mapOutsideCodeSpans(line, (s) => {
      const r = smartenSegment(s, last);
      last = r[r.length - 1] ?? last;
      return r;
    });
  }
  return prefix + lines.join('\n');
}
