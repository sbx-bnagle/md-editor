// Masks everything in a markdown document that is not prose (front matter, code, HTML,
// content block lines, URLs, {{variables}}, table separators), replacing it with spaces.
// The result has the same length and line structure, so positions found in the masked
// text are positions in the original. Used by style rules, grammar and readability.

import { frontMatterRange } from './frontmatter';
import { isContentBlockLine } from './contentBlocks';
import { isDashSyntaxLine } from './smartQuotes';

const INLINE_EXCLUDE = [
  /`+[^`]*?`+/g, // code spans (simple form)
  /<!--[\s\S]*?-->/g, // HTML comments on one line
  /<\/?[A-Za-z][^>]*>/g, // HTML tags
  /\{\{[^{}]*\}\}/g, // variables
  /\]\([^)\s]*(?:\s+"[^"]*")?\)/g, // link destinations
  /^\s*\[[^\]]+\]:\s*\S+.*$/g, // reference definitions
  /<https?:\/\/[^>]+>/g, // autolinks
  /https?:\/\/[^\s)>\]]+/g, // bare URLs
  /\[\^[^\]]+\]/g, // footnote references
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // e-mail addresses
];

function blank(s: string): string {
  return s.replace(/[^\n]/g, ' ');
}

export function maskNonProse(text: string): string {
  let out = text;
  const fm = frontMatterRange(text);
  if (fm) out = blank(out.slice(0, fm[1])) + out.slice(fm[1]);

  const lines = out.split('\n');
  let fence: string | null = null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      lines[i] = blank(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      lines[i] = blank(line);
      continue;
    }
    if (inComment) {
      const end = line.indexOf('-->');
      if (end === -1) {
        lines[i] = blank(line);
        continue;
      }
      lines[i] = blank(line.slice(0, end + 3)) + line.slice(end + 3);
      inComment = false;
    }
    if (isContentBlockLine(line) || (line.includes('-') && isDashSyntaxLine(line) && line.trim() !== '')) {
      lines[i] = blank(line);
      continue;
    }
    let l = lines[i];
    const open = l.indexOf('<!--');
    if (open !== -1 && l.indexOf('-->', open) === -1) {
      l = l.slice(0, open) + blank(l.slice(open));
      inComment = true;
    }
    for (const re of INLINE_EXCLUDE) l = l.replace(re, (m) => blank(m));
    lines[i] = l;
  }
  return lines.join('\n');
}

/** Masked text with markdown punctuation (heading marks, list markers, emphasis, ==marks==) also blanked. */
export function plainProse(text: string): string {
  return maskNonProse(text)
    .split('\n')
    .map((l) =>
      l
        .replace(/^(\s*)(#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s)/, (m) => blank(m))
        .replace(/[*_~]{1,3}(?=\S)|(?<=\S)[*_~]{1,3}|==(?=\S)|(?<=\S)==/g, (m) => blank(m))
        .replace(/!?\[|\]/g, ' ')
        .replace(/\|/g, ' '),
    )
    .join('\n');
}

/** Ranges [from, to) of heading text (ATX headings), in original positions. */
export function headingRanges(text: string): Array<{ from: number; to: number; level: number; text: string }> {
  const masked = maskNonProse(text);
  const out: Array<{ from: number; to: number; level: number; text: string }> = [];
  let offset = 0;
  for (const line of masked.split('\n')) {
    const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[2].trim()) {
      const start = offset + line.indexOf(m[2]);
      const original = text.slice(start, start + m[2].length);
      out.push({ from: start, to: start + m[2].length, level: m[1].length, text: original });
    }
    offset += line.length + 1;
  }
  return out;
}
