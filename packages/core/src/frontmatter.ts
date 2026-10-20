import { parse as parseYaml } from 'yaml';

export interface FrontMatter {
  /** Parsed YAML mapping ({} when absent or invalid). */
  data: Record<string, unknown>;
  /** Markdown after the front matter block. */
  body: string;
  /** Character offset where body starts in the original text. */
  bodyOffset: number;
  /** Zero-based line number where body starts. */
  bodyLine: number;
  /** True when a front matter block was found. */
  present: boolean;
  error?: string;
}

const OPEN = /^﻿?---[ \t]*\r?\n/;

/** Finds a YAML front matter block delimited by `---` and `---` (or `...`) at the start of the text. */
export function splitFrontMatter(text: string): FrontMatter {
  const open = OPEN.exec(text);
  if (!open) return { data: {}, body: text, bodyOffset: 0, bodyLine: 0, present: false };
  const start = open[0].length;
  const closeRe = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closeRe.lastIndex = start;
  const close = closeRe.exec(text);
  if (!close) return { data: {}, body: text, bodyOffset: 0, bodyLine: 0, present: false };
  const yamlText = text.slice(start, close.index);
  const bodyOffset = close.index + close[0].length;
  const bodyLine = countLines(text.slice(0, bodyOffset));
  let data: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    const parsed = parseYaml(yamlText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    else if (parsed != null) error = 'Front matter must be a list of “name: value” lines.';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { data, body: text.slice(bodyOffset), bodyOffset, bodyLine, present: true, error };
}

function countLines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/** Returns the [from, to) character range of the front matter block, or null. */
export function frontMatterRange(text: string): [number, number] | null {
  const fm = splitFrontMatter(text);
  return fm.present ? [0, fm.bodyOffset] : null;
}
