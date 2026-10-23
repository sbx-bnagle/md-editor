// Theme components, written like Jekyll includes:
//
//   {% include figure.html src="images/plan.png" caption="The site plan" size="half" %}
//
// On a line of its own a component is a block; inside a paragraph it is inline. Templates are
// HTML files in a theme's includes/ folder (or the app's built-in ones) using a subset of Liquid:
//   {{ include.caption }}          a parameter        {{ title }}   a document variable
//   {{ include.alt | default: include.caption }}    filters: see evaluateExpression below
//   {% if include.caption %} … {% elsif … %} … {% else %} … {% endif %}, {% unless %}, ==, !=,
//   <, >, <=, >=, contains, empty, blank, and, or
//   {% for tag in tags %} … {% else %} … {% endfor %} over front matter lists, with forloop.*
//   {% assign name = value | filter %}, {% comment %} … {% endcomment %}, {% include other.html … %}
//   {%- and -%} (and {{- -}}) remove the white space before or after the tag.
// Output is HTML-escaped unless it comes from markdownify or raw (unlike Jekyll, which does not
// escape), so parameter text is safe inside attributes. A list prints as its items joined by
// ", ", as {{ name }} does in documents.

import { escapeHtml } from './render/markdown';
import { isClosingFence, openingFence } from './fences';
import type { TemplateValue } from './variables';

const NAME = String.raw`[\w][\w./-]*\.html`;
const VALUE = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s%"']+`;
const ARGS = String.raw`(?:\s+[\w-]+\s*=\s*(?:${VALUE}))*`;
const TAG = String.raw`\{%-?\s*include\s+(${NAME})(${ARGS})\s*-?%\}`;

/** An include tag anywhere in a line. */
export const INCLUDE_TAG_RE = new RegExp(TAG, 'g');
const INCLUDE_LINE_RE = new RegExp(String.raw`^ {0,3}${TAG}\s*$`);

/** A parameter's value: text, true/false, or a list or mapping passed from front matter. */
export type ParamValue = TemplateValue;

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

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Parameters, with unquoted words looked up by `resolve` (undefined: not a variable). */
function parseArgs(args: string, resolve: (word: string) => TemplateValue): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  const re = new RegExp(String.raw`([\w-]+)\s*=\s*(${VALUE})`, 'g');
  for (const m of args.matchAll(re)) {
    const v = m[2];
    const found = v.startsWith('"') || v.startsWith("'") ? undefined : resolve(v);
    if (v.startsWith('"') || v.startsWith("'")) out[m[1]] = unquote(v);
    else if (found !== undefined) out[m[1]] = found;
    else if (v === 'true' || v === 'false') out[m[1]] = v === 'true';
    else out[m[1]] = v;
  }
  return out;
}

/**
 * Parameters of an include tag. Quoted values are text; an unquoted word is a document variable
 * when one has that name (a list when it is one: tags=tags), true/false, or else the word itself
 * (size=half).
 */
export function parseIncludeArgs(args: string, vars: Record<string, string>, lists: Record<string, TemplateValue[]> = {}): Record<string, ParamValue> {
  return parseArgs(args, (w) => (has(lists, w) ? lists[w] : has(vars, w) ? vars[w] : undefined));
}

export interface TemplateContext {
  include: Record<string, ParamValue>;
  vars: Record<string, string>;
  /** Front matter lists by variable name (vars has the same names as joined text). */
  lists?: Record<string, TemplateValue[]>;
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
  | { t: 'for'; name: string; collection: string; reversed: boolean; limit: string | null; offset: string | null; body: Node[]; empty: Node[] }
  | { t: 'assign'; name: string; expr: string }
  | { t: 'include'; name: string; args: string };

class TemplateError extends Error {}

/** Loops stop at this many items (a guard against a mistake in a template, not a limit on real lists). */
const MAX_LOOP = 10_000;

interface Token {
  kind: 'text' | 'out' | 'tag';
  s: string;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\{\{(-?)([\s\S]*?)(-?)\}\}|\{%(-?)([\s\S]*?)(-?)%\}/g;
  let at = 0;
  let trimNext = false;
  const text = (s: string) => {
    const t = trimNext ? s.replace(/^\s+/, '') : s;
    if (t) out.push({ kind: 'text', s: t });
  };
  for (const m of src.matchAll(re)) {
    const isOut = m[2] !== undefined;
    const [trimBefore, inner, trimAfter] = isOut ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
    if (m.index! > at) text(src.slice(at, m.index));
    if (trimBefore) {
      const last = out[out.length - 1];
      if (last?.kind === 'text') {
        last.s = last.s.replace(/\s+$/, '');
        if (!last.s) out.pop();
      }
    }
    out.push({ kind: isOut ? 'out' : 'tag', s: inner.trim() });
    trimNext = !!trimAfter;
    at = m.index! + m[0].length;
  }
  if (at < src.length) text(src.slice(at));
  return out;
}

const IDENT = String.raw`[A-Za-z_][\w-]*`;
const FOR_RE = new RegExp(String.raw`^(${IDENT})\s+in\s+(\([^)]*\)|\S+)((?:\s+(?:reversed|limit\s*:\s*\S+|offset\s*:\s*\S+))*)\s*$`);
const ASSIGN_RE = new RegExp(String.raw`^(${IDENT})\s*=\s*(.+)$`);

function parse(src: string): Node[] {
  const tokens = tokenize(src);
  let i = 0;
  const closing = (word: string): string => {
    const t = tokens[i++];
    if (!t) throw new TemplateError(`“{% ${word} %}” has no “{% end${word} %}”.`);
    return t.s.split(/\s+/)[0];
  };
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
        } else if (word === 'for') {
          const m = FOR_RE.exec(arg);
          if (!m) throw new TemplateError(`Cannot read “{% ${tok.s} %}” (write {% for item in list %}).`);
          const options = m[3];
          const option = (name: string) => new RegExp(String.raw`${name}\s*:\s*(\S+)`).exec(options)?.[1] ?? null;
          const loop = block(['else', 'endfor']);
          let empty: Node[] = [];
          if (closing('for') === 'else') {
            empty = block(['endfor']).body;
            closing('for');
          }
          body.push({ t: 'for', name: m[1], collection: m[2], reversed: /\breversed\b/.test(options), limit: option('limit'), offset: option('offset'), body: loop.body, empty });
        } else if (word === 'assign') {
          const m = ASSIGN_RE.exec(arg);
          if (!m) throw new TemplateError(`Cannot read “{% ${tok.s} %}” (write {% assign name = value %}).`);
          body.push({ t: 'assign', name: m[1], expr: m[2] });
        } else if (word === 'comment') {
          while (i < tokens.length && !(tokens[i].kind === 'tag' && tokens[i].s === 'endcomment')) i++;
          i++;
        } else if (word === 'include') {
          const m = new RegExp(String.raw`^(${NAME})(${ARGS})\s*$`).exec(arg);
          if (!m) throw new TemplateError(`Cannot read “{% ${tok.s} %}”.`);
          body.push({ t: 'include', name: m[1], args: m[2] });
        } else if (/^(end\w+|else|elsif)$/.test(word)) throw new TemplateError(`“{% ${word} %}” has no opening tag here.`);
        else throw new TemplateError(`“{% ${word} %}” is not supported in components.`);
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

/** A template being rendered: its context, and loop variables and assigned names (innermost last). */
interface Env {
  ctx: TemplateContext;
  scopes: Array<Record<string, TemplateValue>>;
}

/** Text of a value, as output prints it: lists as their items joined by ", ". */
function text(v: TemplateValue): string {
  if (v === undefined || v === false) return '';
  if (v === true) return 'true';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(text).join(', ');
  return '';
}

/** A property of a value: an item's field, or size, first, last or an index of a list. */
function property(v: TemplateValue, key: string): TemplateValue {
  if (Array.isArray(v)) {
    if (key === 'size') return String(v.length);
    if (key === 'first') return v[0];
    if (key === 'last') return v[v.length - 1];
    return /^\d+$/.test(key) ? v[Number(key)] : undefined;
  }
  if (typeof v === 'string') return key === 'size' ? String(v.length) : undefined;
  if (v && typeof v === 'object') return has(v, key) ? v[key] : key === 'size' ? String(Object.keys(v).length) : undefined;
  return undefined;
}

const walk = (v: TemplateValue, keys: string[]) => keys.reduce(property, v);

function lookup(expr: string, env: Env): TemplateValue {
  const e = expr.trim();
  if (/^(["']).*\1$/.test(e)) return unquote(e);
  if (e === 'true' || e === 'false') return e === 'true';
  if (e === 'nil' || e === 'null' || e === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(e)) return e;
  const parts = e.split('.');
  for (let s = env.scopes.length - 1; s >= 0; s--) {
    if (has(env.scopes[s], parts[0])) return walk(env.scopes[s][parts[0]], parts.slice(1));
  }
  if (parts[0] === 'include' && parts.length > 1) return walk(env.ctx.include[parts[1]], parts.slice(2));
  // Document variable names can contain dots (author.name for a nested mapping): the longest name that exists wins.
  const lists = env.ctx.lists ?? {};
  for (let n = parts.length; n >= 1; n--) {
    const name = parts.slice(0, n).join('.');
    if (has(lists, name)) return walk(lists[name], parts.slice(n));
    if (has(env.ctx.vars, name)) return walk(env.ctx.vars[name], parts.slice(n));
  }
  return undefined;
}

const truthy = (v: TemplateValue) => v !== undefined && v !== false;

const isEmpty = (v: TemplateValue) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

const COMPARISONS = ['==', '!=', '>=', '<=', '>', '<', ' contains '];

/** Text for == and != (false is "false", so it differs from a missing value). */
const comparable = (v: TemplateValue) => (typeof v === 'boolean' ? String(v) : text(v));

function compare(a: TemplateValue, op: string, b: TemplateValue, bWord: string): boolean {
  // `empty` and `blank` as in Liquid: an empty list or text (blank: also white space and false).
  if (op === '==' || op === '!=') {
    let equal: boolean;
    if (bWord === 'empty') equal = isEmpty(a);
    else if (bWord === 'blank') equal = isEmpty(a) || a === false || (typeof a === 'string' && !a.trim());
    else equal = comparable(a) === comparable(b);
    return op === '==' ? equal : !equal;
  }
  if (op === 'contains') {
    if (Array.isArray(a)) return a.some((item) => text(item) === text(b));
    if (typeof a === 'string') return a.includes(text(b));
    if (a && typeof a === 'object') return has(a, text(b));
    return false;
  }
  const x = Number(text(a));
  const y = Number(text(b));
  const d = text(a) !== '' && text(b) !== '' && !Number.isNaN(x) && !Number.isNaN(y) ? x - y : text(a).localeCompare(text(b), undefined, { numeric: true });
  return op === '>' ? d > 0 : op === '<' ? d < 0 : op === '>=' ? d >= 0 : d <= 0;
}

function condition(expr: string, env: Env): boolean {
  const ors = splitOutside(expr, ' or ');
  return ors.some((or) =>
    splitOutside(or, ' and ').every((part) => {
      let p = part.trim();
      let negate = false;
      if (p.startsWith('not ')) {
        negate = true;
        p = p.slice(4);
      }
      let r = truthy(lookup(p, env));
      for (const op of COMPARISONS) {
        const sides = splitOutside(p, op);
        if (sides.length === 2) {
          r = compare(lookup(sides[0], env), op.trim(), lookup(sides[1], env), sides[1]);
          break;
        }
      }
      return negate ? !r : r;
    }),
  );
}

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** An expression with its filters: its value, and whether that value is HTML to output as is. */
function evaluateExpression(expr: string, env: Env): { value: TemplateValue; html: boolean } {
  const [first, ...filters] = splitOutside(expr, '|');
  let value: TemplateValue = lookup(first, env);
  let html = false;
  for (const f of filters) {
    const [name, arg] = splitOutside(f, ':');
    const argValue = arg === undefined ? undefined : lookup(arg, env);
    const t = text(value);
    switch (name) {
      case 'default':
        if (!truthy(value) || isEmpty(value)) value = argValue;
        break;
      case 'markdownify':
        value = env.ctx.markdownify(t);
        html = true;
        break;
      case 'raw':
        html = true;
        break;
      case 'plain':
        // Markdown to plain text (for alt text made from a caption).
        value = env.ctx
          .markdownify(t)
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&');
        html = false;
        break;
      case 'escape':
        html = false;
        break;
      case 'upcase':
        value = t.toUpperCase();
        break;
      case 'downcase':
        value = t.toLowerCase();
        break;
      case 'strip':
        value = t.trim();
        break;
      case 'slugify':
        value = slugify(t);
        break;
      case 'theme_url':
        value = env.ctx.themeUrl(t);
        break;
      case 'split':
        if (arg === undefined) throw new TemplateError('The filter “split” needs a separator, as in split: ", ".');
        if (!Array.isArray(value)) value = t === '' ? [] : t.split(text(argValue));
        break;
      case 'join':
        value = Array.isArray(value) ? value.map(text).join(arg === undefined ? ' ' : text(argValue)) : t;
        break;
      case 'size':
        value = String(Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : t.length);
        break;
      case 'first':
        value = Array.isArray(value) ? value[0] : t.slice(0, 1);
        break;
      case 'last':
        value = Array.isArray(value) ? value[value.length - 1] : t.slice(-1);
        break;
      case 'reverse':
        value = Array.isArray(value) ? [...value].reverse() : value;
        break;
      case 'sort': {
        if (!Array.isArray(value)) break;
        // sort: "name" sorts mappings by that field.
        const key = (v: TemplateValue) => text(argValue === undefined ? v : property(v, text(argValue)));
        value = [...value].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: 'base' }));
        break;
      }
      case 'uniq':
        if (Array.isArray(value)) value = value.filter((v, i, all) => all.findIndex((w) => text(w) === text(v)) === i);
        break;
      default:
        throw new TemplateError(`The filter “${name}” is not supported in components.`);
    }
  }
  return { value, html };
}

function output(expr: string, env: Env): string {
  const { value, html } = evaluateExpression(expr, env);
  return html ? text(value) : escapeHtml(text(value));
}

/** The items a loop goes over: a list, a range such as (1..3), a mapping's [key, value] pairs, or one text. */
function collection(expr: string, env: Env): TemplateValue[] {
  const range = /^\((.+?)\.\.(.+)\)$/.exec(expr);
  if (range) {
    const from = Math.trunc(Number(text(lookup(range[1], env))));
    const to = Math.trunc(Number(text(lookup(range[2], env))));
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new TemplateError(`The range “${expr}” needs two numbers.`);
    if (to - from + 1 > MAX_LOOP) throw new TemplateError(`The range “${expr}” has more than ${MAX_LOOP} numbers.`);
    return to < from ? [] : Array.from({ length: to - from + 1 }, (_, k) => String(from + k));
  }
  const v = lookup(expr, env);
  if (Array.isArray(v)) return v;
  if (v === undefined || v === false || v === '') return [];
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => [k, x]);
  return [v];
}

async function evaluate(nodes: Node[], env: Env, depth: number): Promise<string> {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.s;
    else if (n.t === 'out') out += output(n.expr, env);
    else if (n.t === 'if') {
      const branch = n.branches.find((b) => b.cond === null || condition(b.cond, env));
      if (branch) out += await evaluate(branch.body, env, depth);
    } else if (n.t === 'for') {
      let items = collection(n.collection, env);
      const number = (v: string | null) => (v === null ? null : Math.max(0, Math.trunc(Number(text(lookup(v, env)))) || 0));
      const offset = number(n.offset);
      const limit = number(n.limit);
      if (offset !== null) items = items.slice(offset);
      if (limit !== null) items = items.slice(0, limit);
      if (n.reversed) items = [...items].reverse();
      if (items.length > MAX_LOOP) throw new TemplateError(`“{% for ${n.name} in ${n.collection} %}” has more than ${MAX_LOOP} items.`);
      if (!items.length) {
        out += await evaluate(n.empty, env, depth);
        continue;
      }
      const length = items.length;
      for (const [k, item] of items.entries()) {
        const forloop: TemplateValue = {
          index: String(k + 1),
          index0: String(k),
          rindex: String(length - k),
          rindex0: String(length - k - 1),
          first: k === 0,
          last: k === length - 1,
          length: String(length),
        };
        env.scopes.push({ [n.name]: item, forloop });
        try {
          out += await evaluate(n.body, env, depth);
        } finally {
          env.scopes.pop();
        }
      }
    } else if (n.t === 'assign') {
      // As in Liquid, an assigned name lasts for the rest of the template, also after a loop.
      env.scopes[0][n.name] = evaluateExpression(n.expr, env).value;
    } else {
      if (depth >= 5) throw new TemplateError(`Components nest too deeply (at “${n.name}”).`);
      const src = await env.ctx.load(n.name);
      if (src === null) throw new TemplateError(`The component “${n.name}” was not found.`);
      const include = parseArgs(n.args, (w) => lookup(w, env));
      out += await evaluate(parse(src), { ctx: { ...env.ctx, include }, scopes: [{}] }, depth + 1);
    }
  }
  return out;
}

/** Renders a component template; errors (unknown tags, missing components) are returned, not thrown. */
export async function renderComponent(src: string, ctx: TemplateContext): Promise<{ html: string } | { error: string }> {
  try {
    return { html: await evaluate(parse(src), { ctx, scopes: [{}] }, 0) };
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
