// Authorship annotations in iA's Markdown Annotations format v0.2
// (https://github.com/iainc/markdown-annotations). The block sits at the end of the file:
//
//   ...text...
//
//   ---
//   Annotations: 0,95 SHA-256 1132bf5e376a605f5beed4b204456114
//   @Human: 0,20 33,4
//   &AI: 20,13
//   ...
//
// Ranges count grapheme clusters. The editor works in UTF-16 offsets, so this module
// converts between the two.

import { sha256Hex } from './hash';

export type AuthorKind = 'human' | 'ai' | 'reference';

export interface AuthorAnnotation {
  /** Key as written, e.g. "@Brad" or "&Claude <anthropic>". */
  key: string;
  kind: AuthorKind;
  /** Display name: key without the prefix and identifier. */
  name: string;
  /** [start, length] in grapheme clusters. */
  ranges: Array<[number, number]>;
  /** Anything after the ranges (reserved by the spec), preserved verbatim. */
  content: string;
}

export interface AnnotationBlock {
  hashKey: string;
  hashStart: number;
  hashLength: number;
  hash: string;
  authors: AuthorAnnotation[];
  /** Non-author annotations, preserved verbatim. */
  other: Array<{ key: string; value: string }>;
}

export interface SplitAnnotations {
  /** Document text without the annotation block. */
  text: string;
  block: AnnotationBlock | null;
  /** True when the hash matches the text (ranges can be trusted). */
  valid: boolean;
}

/** Author span in UTF-16 offsets of the document text. */
export interface AuthorSpan {
  author: string;
  from: number;
  to: number;
}

const HASH_VALUE = /^(\d+)(?:,(\d+))?\s+SHA-256\s+([0-9a-fA-F]{20,64})$/;
const RANGE = /^(\d+)(?:,(\d+))?$/;

function kindOf(key: string): AuthorKind | null {
  if (key.startsWith('@')) return 'human';
  if (key.startsWith('&')) return 'ai';
  if (key.startsWith('*')) return 'reference';
  return null;
}

function displayName(key: string): string {
  return key.slice(1).replace(/<(?:[^<>\\]|\\.)*>/g, '').split(',')[0].trim();
}

interface RawAnnotation {
  key: string;
  value: string;
  indent: number;
}

function parseAnnotationLines(lines: string[]): RawAnnotation[] | null {
  const out: RawAnnotation[] = [];
  let contIndent: number | null = null;
  for (const line of lines) {
    const indent = /^[ \t]*/.exec(line)![0].length;
    const last = out[out.length - 1];
    if (last && indent >= last.indent + 2 && (line.trim() === '' || contIndent === null || indent >= contIndent)) {
      if (contIndent === null) contIndent = indent;
      last.value += `\n${line.slice(contIndent)}`;
      continue;
    }
    if (line.trim() === '' && last) {
      last.value += '\n';
      continue;
    }
    const m = /^[ \t]*((?:[^:\\]|\\.)+?)[ \t]*:[ ]*(.*?)[ \t]*$/.exec(line);
    if (!m) return null;
    out.push({ key: m[1].replace(/\\:/g, ':'), value: m[2], indent });
    contIndent = null;
  }
  return out;
}

export function graphemeBoundaries(text: string): number[] {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const out: number[] = [];
  for (const s of seg.segment(text)) out.push(s.index);
  out.push(text.length);
  return out;
}

function graphemeSlice(text: string, bounds: number[], start: number, length: number): string | null {
  if (start + length > bounds.length - 1) return null;
  return text.slice(bounds[start], bounds[start + length]);
}

/** Separates the annotation block (if any) from the document text and checks its hash. */
export function splitAnnotations(file: string): SplitAnnotations {
  const none = { text: file, block: null, valid: true };
  if (!file.includes('\n...')) return none;
  const lines = file.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === '') end--;
  if (end < 2 || lines[end].trim() !== '...') return none;
  let start = end - 1;
  while (start >= 0 && lines[start] !== '---') start--;
  if (start < 0) return none;
  const raw = parseAnnotationLines(lines.slice(start + 1, end));
  if (!raw || raw.length === 0) return none;
  const hashMatch = HASH_VALUE.exec(raw[0].value.trim());
  if (!hashMatch) return none;

  const block: AnnotationBlock = {
    hashKey: raw[0].key,
    hashStart: Number(hashMatch[1]),
    hashLength: hashMatch[2] === undefined ? 1 : Number(hashMatch[2]),
    hash: hashMatch[3].toLowerCase(),
    authors: [],
    other: [],
  };
  for (const a of raw.slice(1)) {
    const kind = kindOf(a.key);
    if (!kind) {
      block.other.push({ key: a.key, value: a.value });
      continue;
    }
    const tokens = a.value.split(/\s+/).filter(Boolean);
    const ranges: Array<[number, number]> = [];
    let i = 0;
    for (; i < tokens.length; i++) {
      const r = RANGE.exec(tokens[i]);
      if (!r) break;
      ranges.push([Number(r[1]), r[2] === undefined ? 1 : Number(r[2])]);
    }
    block.authors.push({ key: a.key, kind, name: displayName(a.key), ranges, content: tokens.slice(i).join(' ') });
  }

  const text = lines.slice(0, start).join('\n');
  return { text, block, valid: verifyHash(text, block) };
}

export function verifyHash(text: string, block: AnnotationBlock): boolean {
  const bounds = graphemeBoundaries(text);
  const covered = graphemeSlice(text, bounds, block.hashStart, block.hashLength);
  if (covered === null) return false;
  return sha256Hex(covered).startsWith(block.hash);
}

/** Converts block ranges to UTF-16 spans for the editor. Ranges beyond the text are dropped. */
export function blockToSpans(text: string, block: AnnotationBlock): AuthorSpan[] {
  const bounds = graphemeBoundaries(text);
  const max = bounds.length - 1;
  const spans: AuthorSpan[] = [];
  for (const a of block.authors) {
    for (const [s, l] of a.ranges) {
      if (s >= max) continue;
      const e = Math.min(s + l, max);
      spans.push({ author: a.key, from: bounds[s], to: bounds[e] });
    }
  }
  return spans.sort((x, y) => x.from - y.from);
}

function utf16ToGrapheme(bounds: number[], offset: number): number {
  let lo = 0;
  let hi = bounds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bounds[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface SerializeOptions {
  /** Keys of authors to keep even when they have no spans (preserves names). */
  authors?: string[];
  /** Hash annotation key (default "Annotations"). */
  hashKey?: string;
  other?: Array<{ key: string; value: string }>;
  /** Content preserved after an author's ranges. */
  authorContent?: Record<string, string>;
}

/**
 * Builds the file text: document text followed by an annotation block. Returns the text
 * unchanged when there is nothing to annotate.
 */
export function serializeWithAnnotations(text: string, spans: AuthorSpan[], opts: SerializeOptions = {}): string {
  const other = opts.other ?? [];
  const live = spans.filter((s) => s.to > s.from);
  if (live.length === 0 && other.length === 0) return text;
  const body = text.endsWith('\n') ? text : `${text}\n`;
  const bounds = graphemeBoundaries(body);
  const total = bounds.length - 1;

  const byAuthor = new Map<string, Array<[number, number]>>();
  for (const k of opts.authors ?? []) byAuthor.set(k, []);
  for (const s of live) {
    const a = utf16ToGrapheme(bounds, Math.min(s.from, body.length));
    const b = utf16ToGrapheme(bounds, Math.min(s.to, body.length));
    if (b <= a) continue;
    if (!byAuthor.has(s.author)) byAuthor.set(s.author, []);
    byAuthor.get(s.author)!.push([a, b]);
  }

  const escapeKey = (k: string) => k.replace(/:/g, '\\:');
  const lines = [`${escapeKey(opts.hashKey ?? 'Annotations')}: 0,${total} SHA-256 ${sha256Hex(body).slice(0, 32)}`];
  for (const [key, ivs] of byAuthor) {
    ivs.sort((x, y) => x[0] - y[0]);
    const merged: Array<[number, number]> = [];
    for (const iv of ivs) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    const ranges = merged.map(([a, b]) => (b - a === 1 ? `${a}` : `${a},${b - a}`));
    const content = opts.authorContent?.[key];
    lines.push(`${escapeKey(key)}: ${[...ranges, ...(content ? [content] : [])].join(' ')}`.trimEnd());
  }
  for (const o of other) lines.push(`${escapeKey(o.key)}: ${o.value.replace(/\n/g, '\n  ')}`);
  return `${body}\n---\n${lines.join('\n')}\n...\n`;
}
