// Document variables: YAML front matter values usable as {{name}} in markdown and
// as var(--name) in theme CSS. Child documents inherit their parent's variables and
// can override them locally (see docs/FILE-FORMATS.md).

import { isClosingFence, openingFence } from './fences';

export type VarScope = Readonly<Record<string, string>>;

/** Front matter keys that select app features. They are also available as variables. */
export const RESERVED_KEYS = ['theme', 'voice', 'style'] as const;

/** Flattens a YAML mapping into string variables. Nested mappings use dotted names. */
export function flattenVariables(data: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) out[name] = '';
    else if (value instanceof Date) out[name] = value.toISOString().slice(0, 10);
    else if (Array.isArray(value)) out[name] = value.map((v) => (v == null ? '' : String(v))).join(', ');
    else if (typeof value === 'object') Object.assign(out, flattenVariables(value as Record<string, unknown>, name));
    else out[name] = String(value);
  }
  return out;
}

/** Built-in variables available to every document. Front matter can override them. */
export function builtinVariables(now: Date, extra: Record<string, string> = {}): Record<string, string> {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    today: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    'today-iso': `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    ...extra,
  };
}

/** CSS custom property name for a variable: {{Client Name}} -> --Client-Name, {{client.name}} -> --client-name. */
export function cssIdent(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_-]+/g, '-');
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return id;
}

/** CSS string literal. */
export function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ')}"`;
}

const VAR_RE = /(\\?)\{\{\s*([^{}\n]+?)\s*\}\}/g;

export interface SubstituteResult {
  text: string;
  missing: string[];
  used: string[];
}

/**
 * Replaces {{name}} with variable values. Fenced code blocks and inline code spans are left
 * untouched so documentation about templates renders literally. `\{{name}}` produces a literal.
 */
export function substituteVariables(markdown: string, scope: VarScope): SubstituteResult {
  const missing = new Set<string>();
  const used = new Set<string>();
  const replaceIn = (s: string) =>
    s.replace(VAR_RE, (whole, escape: string, name: string) => {
      if (escape) return whole.slice(1);
      if (Object.prototype.hasOwnProperty.call(scope, name)) {
        used.add(name);
        return scope[name];
      }
      missing.add(name);
      return whole;
    });

  const lines = markdown.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }
    const opening = openingFence(line);
    if (opening) {
      fence = opening;
      continue;
    }
    if (!line.includes('{{')) continue;
    lines[i] = mapOutsideCodeSpans(line, replaceIn);
  }
  return { text: lines.join('\n'), missing: [...missing], used: [...used] };
}

/** Applies fn to the parts of a line that are not inside `code spans`. */
export function mapOutsideCodeSpans(line: string, fn: (s: string) => string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf('`', i);
    if (tick === -1) {
      out += fn(line.slice(i));
      break;
    }
    out += fn(line.slice(i, tick));
    let run = 1;
    while (line[tick + run] === '`') run++;
    const ticks = '`'.repeat(run);
    let close = line.indexOf(ticks, tick + run);
    while (close !== -1 && line[close + run] === '`') close = line.indexOf(ticks, close + run + 1);
    if (close === -1) {
      out += fn(line.slice(tick));
      break;
    }
    out += line.slice(tick, close + run);
    i = close + run;
  }
  return out;
}
