// Theme components, written like Jekyll includes:
//
//   {% include figure.html src="images/plan.png" caption="The site plan" size="half" %}
//
// On a line of its own a component is a block; inside a paragraph it is inline. Templates are
// HTML files in a theme's includes/ folder (or the app's built-in ones) using a subset of Liquid:
//   {{ include.caption }}          a parameter        {{ title }}   a document variable
//   {{ include.alt | default: include.caption }}    filters: default, markdownify, plain, raw,
//                                                    upcase, downcase, strip, theme_url
//   {% if include.caption %} … {% elsif … %} … {% else %} … {% endif %}, {% unless %}, ==, !=,
//   and, or, {% comment %} … {% endcomment %}, {% include other.html … %}
// Output is HTML-escaped unless it comes from markdownify or raw (unlike Jekyll, which does not
// escape), so parameter text is safe inside attributes.

import { escapeHtml } from './render/markdown';
import { isClosingFence, openingFence } from './fences';

const NAME = String.raw`[\w][\w./-]*\.html`;
const VALUE = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s%"']+`;
const ARGS = String.raw`(?:\s+[\w-]+\s*=\s*(?:${VALUE}))*`;
const TAG = String.raw`\{%-?\s*include\s+(${NAME})(${ARGS})\s*-?%\}`;

/** An include tag anywhere in a line. */
export const INCLUDE_TAG_RE = new RegExp(TAG, 'g');
const INCLUDE_LINE_RE = new RegExp(String.raw`^ {0,3}${TAG}\s*$`);

export type ParamValue = string | boolean | undefined;

export interface IncludeTag {
  name: string;
  /** Raw argument text, parsed with parseIncludeArgs once variables are known. */
  args: string;
}

/** An include tag that is the whole line (a block component). */
export function parseIncludeLine(line: string): IncludeTag | null {
  const m = INCLUDE_LINE_RE.exec(line);
  return m ? { name: m[1], args: m[2] } : null;
}

function unquote(v: string): string {
  return v.slice(1, -1).replace(/\\(.)/g, '$1');
}

/**
 * Parameters of an include tag. Quoted values are text; an unquoted word is a document variable
 * when one has that name, true/false, or else the word itself (size=half).
 */
export function parseIncludeArgs(args: string, vars: Record<string, string>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  const re = new RegExp(String.raw`([\w-]+)\s*=\s*(${VALUE})`, 'g');
  for (const m of args.matchAll(re)) {
    const v = m[2];
    if (v.startsWith('"') || v.startsWith("'")) out[m[1]] = unquote(v);
    else if (Object.prototype.hasOwnProperty.call(vars, v)) out[m[1]] = vars[v];
    else if (v === 'true' || v === 'false') out[m[1]] = v === 'true';
    else out[m[1]] = v;
  }
  return out;
}

export interface TemplateContext {
  include: Record<string, ParamValue>;
  vars: Record<string, string>;
  /** Loads another component's template (nested includes). */
  load(name: string): Promise<string | null>;
  /** Inline markdown to HTML. */
  markdownify(text: string): string;
  /** URL of a file in the theme folder. */
  themeUrl(rel: string): string;
}

type Node =
  | { t: 'text'; s: string }
  | { t: 'out'; expr: string }
  | { t: 'if'; branches: Array<{ cond: string | null; body: Node[] }> }
  | { t: 'include'; name: string; args: string };

class TemplateError extends Error {}

function tokenize(src: string): Array<{ kind: 'text' | 'out' | 'tag'; s: string }> {
  const out: Array<{ kind: 'text' | 'out' | 'tag'; s: string }> = [];
  const re = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}/g;
  let at = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > at) out.push({ kind: 'text', s: src.slice(at, m.index) });
    out.push(m[1] !== undefined ? { kind: 'out', s: m[1].trim() } : { kind: 'tag', s: m[2].trim() });
    at = m.index! + m[0].length;
  }
  if (at < src.length) out.push({ kind: 'text', s: src.slice(at) });
  return out;
}

function parse(src: string): Node[] {
  const tokens = tokenize(src);
  let i = 0;
  const block = (ends: string[]): { body: Node[]; end: string } => {
    const body: Node[] = [];
    while (i < tokens.length) {
      const tok = tokens[i++];
      if (tok.kind === 'text') body.push({ t: 'text', s: tok.s });
      else if (tok.kind === 'out') body.push({ t: 'out', expr: tok.s });
      else {
        const [word, ...rest] = tok.s.split(/\s+/);
        const arg = rest.join(' ');
        if (ends.includes(word)) {
          i--;
          return { body, end: word };
        }
        if (word === 'if' || word === 'unless') {
          const branches: Array<{ cond: string | null; body: Node[] }> = [];
          let cond: string | null = word === 'unless' ? `not ${arg}` : arg;
          const close = word === 'if' ? 'endif' : 'endunless';
          for (;;) {
            const r = block(['elsif', 'else', close]);
            branches.push({ cond, body: r.body });
            const t = tokens[i++];
            if (!t) throw new TemplateError(`“{% ${word} %}” has no “{% ${close} %}”.`);
            const [w, ...a] = t.s.split(/\s+/);
            if (w === close) break;
            cond = w === 'else' ? null : a.join(' ');
          }
          body.push({ t: 'if', branches });
        } else if (word === 'comment') {
          while (i < tokens.length && !(tokens[i].kind === 'tag' && tokens[i].s === 'endcomment')) i++;
          i++;
        } else if (word === 'include') {
          const m = new RegExp(String.raw`^(${NAME})(${ARGS})\s*$`).exec(arg);
          if (!m) throw new TemplateError(`Cannot read “{% ${tok.s} %}”.`);
          body.push({ t: 'include', name: m[1], args: m[2] });
        } else throw new TemplateError(`“{% ${word} %}” is not supported in components.`);
      }
    }
    if (ends.length) throw new TemplateError(`Missing “{% ${ends[ends.length - 1]} %}”.`);
    return { body, end: '' };
  };
  return block([]).body;
}

/** Splits on `sep` outside quotes. */
function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (s.startsWith(sep, k)) {
      out.push(cur);
      cur = '';
      k += sep.length - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function lookup(expr: string, ctx: TemplateContext): ParamValue {
  const e = expr.trim();
  if (/^(["']).*\1$/.test(e)) return unquote(e);
  if (e === 'true' || e === 'false') return e === 'true';
  if (e === 'nil' || e === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(e)) return e;
  if (e.startsWith('include.')) return ctx.include[e.slice('include.'.length)];
  return Object.prototype.hasOwnProperty.call(ctx.vars, e) ? ctx.vars[e] : undefined;
}

const truthy = (v: ParamValue) => v !== undefined && v !== false;

function condition(expr: string, ctx: TemplateContext): boolean {
  const ors = splitOutside(expr, ' or ');
  return ors.some((or) =>
    splitOutside(or, ' and ').every((part) => {
      let p = part.trim();
      let negate = false;
      if (p.startsWith('not ')) {
        negate = true;
        p = p.slice(4);
      }
      let r: boolean;
      const ne = splitOutside(p, '!=');
      const eq = splitOutside(p, '==');
      if (ne.length === 2) r = String(lookup(ne[0], ctx) ?? '') !== String(lookup(ne[1], ctx) ?? '');
      else if (eq.length === 2) r = String(lookup(eq[0], ctx) ?? '') === String(lookup(eq[1], ctx) ?? '');
      else r = truthy(lookup(p, ctx));
      return negate ? !r : r;
    }),
  );
}

function output(expr: string, ctx: TemplateContext): string {
  const [first, ...filters] = splitOutside(expr, '|');
  let value: ParamValue = lookup(first, ctx);
  let html = false;
  for (const f of filters) {
    const [name, arg] = splitOutside(f, ':');
    const text = value === undefined || value === false ? '' : String(value);
    switch (name) {
      case 'default':
        if (!truthy(value) || value === '') value = lookup(arg ?? '', ctx);
        break;
      case 'markdownify':
        value = ctx.markdownify(text);
        html = true;
        break;
      case 'raw':
        html = true;
        break;
      case 'plain':
        // Markdown to plain text (for alt text made from a caption).
        value = ctx
          .markdownify(text)
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&');
        html = false;
        break;
      case 'upcase':
        value = text.toUpperCase();
        break;
      case 'downcase':
        value = text.toLowerCase();
        break;
      case 'strip':
        value = text.trim();
        break;
      case 'escape':
        break;
      case 'theme_url':
        value = ctx.themeUrl(text);
        break;
      default:
        throw new TemplateError(`The filter “${name}” is not supported in components.`);
    }
  }
  const text = value === undefined || value === false ? '' : String(value);
  return html ? text : escapeHtml(text);
}

async function evaluate(nodes: Node[], ctx: TemplateContext, depth: number): Promise<string> {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.s;
    else if (n.t === 'out') out += output(n.expr, ctx);
    else if (n.t === 'if') {
      const branch = n.branches.find((b) => b.cond === null || condition(b.cond, ctx));
      if (branch) out += await evaluate(branch.body, ctx, depth);
    } else {
      if (depth >= 5) throw new TemplateError(`Components nest too deeply (at “${n.name}”).`);
      const src = await ctx.load(n.name);
      if (src === null) throw new TemplateError(`The component “${n.name}” was not found.`);
      out += await evaluate(parse(src), { ...ctx, include: parseIncludeArgs(n.args, ctx.vars) }, depth + 1);
    }
  }
  return out;
}

/** Renders a component template; errors (unknown tags, missing components) are returned, not thrown. */
export async function renderComponent(src: string, ctx: TemplateContext): Promise<{ html: string } | { error: string }> {
  try {
    return { html: await evaluate(parse(src), ctx, 0) };
  } catch (e) {
    if (e instanceof TemplateError) return { error: e.message };
    throw e;
  }
}

/** Images in component output that have no alt attribute (screen readers cannot describe them). */
export function imagesWithoutAlt(html: string): number {
  return (html.match(/<img\b[^>]*>/gi) ?? []).filter((tag) => !/\salt\s*=\s*("[^"]+"|'[^']+')/i.test(tag)).length;
}

/**
 * Inline include tags in markdown text (not in fenced code or code spans): their ranges, so the
 * caller can replace them with rendered HTML.
 */
export function findInlineIncludes(text: string): Array<{ from: number; to: number; tag: IncludeTag }> {
  const out: Array<{ from: number; to: number; tag: IncludeTag }> = [];
  let offset = 0;
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const f: string | null = fence ? null : openingFence(line);
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
    } else if (f) fence = f;
    else if (line.includes('{%')) {
      // Code spans: runs of backticks closed by a run of the same length.
      const code: Array<[number, number]> = [];
      for (let k = 0; k < line.length; ) {
        const run = /^`+/.exec(line.slice(k));
        if (!run) {
          k++;
          continue;
        }
        const close = line.indexOf(run[0], k + run[0].length);
        if (close === -1) {
          k += run[0].length;
          continue;
        }
        code.push([k, close + run[0].length]);
        k = close + run[0].length;
      }
      for (const m of line.matchAll(INCLUDE_TAG_RE)) {
        const from = m.index!;
        if (code.some(([a, b]) => from >= a && from < b)) continue;
        out.push({ from: offset + from, to: offset + from + m[0].length, tag: { name: m[1], args: m[2] } });
      }
    }
    offset += line.length + 1;
  }
  return out;
}
