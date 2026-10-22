// Maps an edit made to the text of one rendered block in the preview (a paragraph, heading or
// list item) back to the markdown source.
//
// The block's inline markdown is projected into the text the preview shows, with the source
// range of every visible character: markers (*, **, `, [...](...)) are invisible, escapes and
// entities collapse to one character, -- and --- become dashes, {{variables}} show their value.
// The projection must equal the preview's text, or the edit is refused; nothing is written on
// a guess. Changes that would cut through formatting, variables, footnotes or inline HTML are
// refused too, with a message pointing to the editor.

import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { headerlessTables } from './render/headerlessTables';
import { markedText } from './render/mark';
import { isContentBlockLine } from './contentBlocks';
import { splitFrontMatter } from './frontmatter';
import { curlyQuote, smartenDashes } from './smartQuotes';
import { flattenVariables } from './variables';

type Token = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number];

export interface PreviewEdit {
  /** data-src-line of the edited element (0-based line in the file). */
  line: number;
  /** The block's text as shown before and after the edit. */
  before: string;
  after: string;
}

export type PreviewEditResult = { from: number; to: number; insert: string } | { error: string } | null;

interface Unit {
  /** Rendered character; '' for a footnote reference whose text is matched from the preview. */
  ch: string;
  /** Source range in the block's inline content. */
  from: number;
  to: number;
  kind: 'text' | 'code' | 'atomic';
  /** Number of formatting pairs around it. */
  depth: number;
  wild?: boolean;
}

interface Pair {
  open: [number, number];
  close: [number, number];
  kind: string;
}

class Unmappable extends Error {}

const parser = new MarkdownIt({ html: true, linkify: true, typographer: false }).use(footnote).use(headerlessTables).use(markedText);

const EDITOR_HINT = 'Make this change in the editor.';

/** Inline tokens → rendered characters with source ranges, plus the formatting pairs. */
function project(src: string, children: Token[], vars: Record<string, string>): { units: Unit[]; pairs: Pair[]; barriers: number[] } {
  const units: Unit[] = [];
  const pairs: Pair[] = [];
  const barriers: number[] = [];
  const open: Array<{ at: [number, number]; kind: string }> = [];
  let pos = 0;
  const fail = (): never => {
    throw new Unmappable();
  };
  const expect = (s: string) => {
    if (!src.startsWith(s, pos)) fail();
    const at: [number, number] = [pos, pos + s.length];
    pos += s.length;
    return at;
  };
  const push = (ch: string, from: number, to: number, kind: Unit['kind']) => units.push({ ch, from, to, kind, depth: open.length });
  const openPair = (at: [number, number], kind: string) => open.push({ at, kind });
  const closePair = (at: [number, number]) => {
    const o = open.pop() ?? fail();
    pairs.push({ open: o.at, close: at, kind: o.kind });
  };
  /** Skips a link or image destination after `]`: (url "title"), [ref] or nothing. */
  const destination = (): [number, number] => {
    const start = pos;
    expect(']');
    if (src[pos] === '(') {
      let depth = 0;
      let quote: string | null = null;
      for (; pos < src.length; pos++) {
        const c = src[pos];
        if (c === '\\') {
          pos++;
          continue;
        }
        if (quote) {
          if (c === quote) quote = null;
        } else if ((c === '"' || c === "'") && /\s/.test(src[pos - 1] ?? '')) quote = c;
        else if (c === '(') depth++;
        else if (c === ')' && --depth === 0) {
          pos++;
          return [start, pos];
        }
      }
      fail();
    }
    if (src[pos] === '[') {
      const end = src.indexOf(']', pos);
      if (end < 0) fail();
      pos = end + 1;
    }
    return [start, pos];
  };
  /** Skips text in brackets (image alt text, inline footnotes), allowing nesting and escapes. */
  const brackets = () => {
    let depth = 0;
    for (; pos < src.length; pos++) {
      const c = src[pos];
      if (c === '\\') {
        pos++;
        continue;
      }
      if (c === '[') depth++;
      else if (c === ']' && --depth === 0) return;
    }
    fail();
  };
  const text = (content: string) => {
    let i = 0;
    while (i < content.length) {
      if (content.startsWith('{{', i)) {
        const m = /^\{\{\s*([^{}\n]+?)\s*\}\}/.exec(content.slice(i));
        if (m && Object.prototype.hasOwnProperty.call(vars, m[1]) && src.startsWith(m[0], pos)) {
          for (const ch of vars[m[1]]) push(ch, pos, pos + m[0].length, 'atomic');
          pos += m[0].length;
          i += m[0].length;
          continue;
        }
      }
      if (content[i] === '-') {
        let n = 1;
        while (content[i + n] === '-') n++;
        if (src.startsWith('-'.repeat(n), pos)) {
          const dash = n === 2 || n === 3 ? smartenDashes('-'.repeat(n)) : '-'.repeat(n);
          if (dash.length === 1) push(dash, pos, pos + n, 'text');
          else for (let k = 0; k < n; k++) push('-', pos + k, pos + k + 1, 'text');
          pos += n;
          i += n;
          continue;
        }
      }
      const c = content[i];
      if (src[pos] === '&') {
        const semi = src.indexOf(';', pos);
        const decoded = semi > pos && semi - pos <= 40 ? parser.utils.unescapeAll(src.slice(pos, semi + 1)) : '';
        if (decoded && decoded !== src.slice(pos, semi + 1) && content.startsWith(decoded, i)) {
          for (const ch of decoded) push(ch, pos, semi + 1, 'atomic');
          i += decoded.length;
          pos = semi + 1;
          continue;
        }
      }
      if (src[pos] === c) {
        push(c, pos, pos + 1, 'text');
        pos++;
        i++;
      } else if (src[pos] === '\\' && src[pos + 1] === c) {
        push(c, pos, pos + 2, 'text');
        pos += 2;
        i++;
      } else fail();
    }
  };

  for (const t of children) {
    switch (t.type) {
      case 'text':
        text(t.content);
        break;
      case 'softbreak':
      case 'hardbreak': {
        const nl = src.indexOf('\n', pos);
        if (nl < 0 || !/^[ \t\\]*$/.test(src.slice(pos, nl))) fail();
        push('\n', nl, nl + 1, 'text');
        pos = nl + 1;
        while (src[pos] === ' ' || src[pos] === '\t') pos++;
        break;
      }
      case 'em_open':
      case 'strong_open':
      case 's_open':
      case 'mark_open':
        openPair(expect(t.markup), t.type);
        break;
      case 'em_close':
      case 'strong_close':
      case 's_close':
      case 'mark_close':
        closePair(expect(t.markup));
        break;
      case 'code_inline': {
        openPair(expect(t.markup), 'code');
        const end = src.indexOf(t.markup, pos);
        if (end < 0) fail();
        // markdown-it drops one space at each end when both are present, and turns newlines into spaces.
        let from = pos;
        let to = end;
        if (to - from >= 2 && /^[ \n]/.test(src[from]) && /[ \n]$/.test(src[to - 1]) && src.slice(from, to).trim()) {
          from++;
          to--;
        }
        if (to - from !== t.content.length) fail();
        for (let k = 0; k < t.content.length; k++) push(t.content[k], from + k, from + k + 1, 'code');
        pos = end;
        closePair(expect(t.markup));
        break;
      }
      case 'link_open':
        if (t.markup === 'linkify') openPair([pos, pos], 'link');
        else openPair(expect(t.markup === 'autolink' ? '<' : '['), 'link');
        break;
      case 'link_close': {
        const markup = t.markup;
        if (markup === 'linkify') closePair([pos, pos]);
        else if (markup === 'autolink') closePair(expect('>'));
        else closePair(destination());
        break;
      }
      case 'image': {
        const start = pos;
        expect('!');
        brackets();
        destination();
        barriers.push(start);
        break;
      }
      case 'html_inline':
        barriers.push(pos);
        expect(t.content);
        break;
      case 'footnote_ref': {
        const start = pos;
        if (src.startsWith('[^', pos)) {
          const end = src.indexOf(']', pos);
          if (end < 0) fail();
          pos = end + 1;
        } else if (src.startsWith('^[', pos)) {
          pos++;
          brackets();
          pos++;
        } else fail();
        units.push({ ch: '', from: start, to: pos, kind: 'atomic', depth: open.length, wild: true });
        break;
      }
      default:
        fail();
    }
  }
  if (open.length || src.slice(pos).trim()) fail();
  return { units, pairs, barriers };
}

/** Collapses whitespace runs to one space (as the preview shows them) and trims the ends. */
function collapse(units: Unit[]): Unit[] {
  const out: Unit[] = [];
  for (const u of units) {
    const space = !u.wild && /\s/.test(u.ch);
    const prev = out[out.length - 1];
    if (space && prev && !prev.wild && prev.ch === ' ') prev.to = u.to;
    else out.push(space ? { ...u, ch: ' ' } : { ...u });
  }
  while (out.length && out[0].ch === ' ') out.shift();
  while (out.length && out[out.length - 1].ch === ' ') out.pop();
  return out;
}

const collapseText = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lines the units up with the preview's text; footnote references take the text the preview shows. */
function align(units: Unit[], shown: string): Unit[] | null {
  const groups: Array<{ wild: boolean; units: Unit[] }> = [];
  for (const u of units) {
    const last = groups[groups.length - 1];
    if (!u.wild && last && !last.wild) last.units.push(u);
    else groups.push({ wild: !!u.wild, units: [u] });
  }
  const re = new RegExp(`^${groups.map((g) => (g.wild ? '([\\s\\S]*?)' : `(${escapeRe(g.units.map((u) => u.ch).join(''))})`)).join('')}$`);
  const m = re.exec(shown);
  if (!m) return null;
  const out: Unit[] = [];
  groups.forEach((g, i) => {
    if (g.wild) for (const ch of m[i + 1]) out.push({ ...g.units[0], ch, wild: false });
    else out.push(...g.units);
  });
  return out;
}

/** Escapes what would otherwise become markdown syntax in typed text. */
function escapeInline(text: string, atLineStart: boolean): string {
  let out = text
    .replace(/[\\`*[\]<~]/g, '\\$&')
    .replace(/\{\{/g, '\\{{')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'));
  if (atLineStart) out = out.replace(/^([#>+-])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
  return out;
}

/** Typed text as the editor would have written it: curly quotes and dashes. */
function smarten(text: string, before: string): string {
  let out = '';
  for (const ch of text) out += ch === '"' || ch === "'" ? curlyQuote(ch, (out || before).slice(-1) || undefined) : ch;
  return smartenDashes(out);
}

interface Block {
  /** Inline markdown of the block, as markdown-it sees it. */
  content: string;
  children: Token[];
  /** File offset of each character of `content` (plus one past the end). */
  offsets: number[];
}

/** Finds the paragraph or heading starting on `line` (0-based file line). */
function findBlock(fileText: string, line: number): Block | null {
  const fm = splitFrontMatter(fileText);
  const bodyLines = fm.body.split('\n');
  // Content block lines are rendered on their own; blank them so paragraphs end where the preview's do.
  const parsed = bodyLines.map((l) => (isContentBlockLine(l) ? '' : l)).join('\n');
  const tokens = parser.parse(parsed, {});
  const rel = line - fm.bodyLine;
  const i = tokens.findIndex((t) => (t.type === 'paragraph_open' || t.type === 'heading_open') && t.map?.[0] === rel);
  const inline = tokens[i + 1];
  if (i < 0 || inline?.type !== 'inline' || !inline.map || !inline.children) return null;
  const starts: number[] = [];
  let off = fm.bodyOffset;
  for (const l of bodyLines) {
    starts.push(off);
    off += l.length + 1;
  }
  const offsets: number[] = [];
  const contentLines = inline.content.split('\n');
  for (let k = 0; k < contentLines.length; k++) {
    const fileLine = bodyLines[inline.map[0] + k];
    const cl = contentLines[k];
    if (fileLine === undefined) return null;
    const at = fileLine.endsWith(cl) ? fileLine.length - cl.length : fileLine.indexOf(cl);
    if (at < 0) return null;
    const base = starts[inline.map[0] + k] + at;
    for (let c = 0; c < cl.length; c++) offsets.push(base + c);
    offsets.push(base + cl.length);
  }
  return { content: inline.content, children: inline.children, offsets };
}

/**
 * Maps a preview edit to a change of `fileText`. `vars` are the variables in effect for the file
 * (its own front matter is added). Returns null when nothing changed.
 */
export function mapPreviewEdit(fileText: string, edit: PreviewEdit, vars: Record<string, string> = {}): PreviewEditResult {
  const before = collapseText(edit.before);
  const after = collapseText(edit.after);
  if (before === after) return null;
  const block = findBlock(fileText, edit.line);
  if (!block) return { error: `This part of the preview could not be matched to the document. ${EDITOR_HINT}` };
  const scope = { ...vars, ...flattenVariables(splitFrontMatter(fileText).data) };
  let projected: ReturnType<typeof project>;
  try {
    projected = project(block.content, block.children, scope);
  } catch (e) {
    if (e instanceof Unmappable) return { error: `This paragraph uses markdown the preview cannot edit. ${EDITOR_HINT}` };
    throw e;
  }
  const units = align(collapse(projected.units), before);
  if (!units) return { error: `The preview is out of date with the document. ${EDITOR_HINT}` };

  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  // A pure insertion or deletion can often sit in several places ("bar " or "ar b" deleted from
  // "foo bar baz" gives the same text). Try each, starting with the first difference.
  const candidates: Array<[number, number, string]> = [[p, before.length - s, after.slice(p, after.length - s)]];
  const [, end0, typed0] = candidates[0];
  if (!typed0 || p === end0) {
    const removed = before.slice(p, end0);
    const moving = typed0 || removed;
    for (let q = p, e = end0, m = moving; q > 0 && before[q - 1] === m[m.length - 1]; ) {
      m = before[q - 1] + m.slice(0, -1);
      q--;
      if (typed0) candidates.push([q, q, m]);
      else candidates.push([q, --e, '']);
    }
  }
  let first: PreviewEditResult = null;
  for (const [cp, ce, ct] of candidates) {
    const r = mapAt(before, units, projected, block, cp, ce, ct);
    if (!('error' in r)) return r;
    first ??= r;
  }
  return first;
}

function mapAt(before: string, units: Unit[], projected: ReturnType<typeof project>, block: Block, p: number, removedEnd: number, typed: string): { from: number; to: number; insert: string } | { error: string } {
  let from: number;
  let to: number;
  let code: boolean;
  if (p === removedEnd) {
    // Insertion between two characters. Text that continues a word joins it (fixing a typo in a
    // bold word keeps it bold); a new word next to a link or bold word goes outside it.
    const left = units[p - 1];
    const right = units[p];
    const usable = (u: Unit | undefined): u is Unit => !!u && u.kind !== 'atomic';
    const word = (u: Unit | undefined) => !!u && !/\s/.test(u.ch);
    let side: 'left' | 'right';
    if (!usable(left) && !usable(right)) return { error: `Text cannot be added inside a variable or footnote. ${EDITOR_HINT}` };
    if (!usable(left)) side = 'right';
    else if (!usable(right)) side = 'left';
    else if (word(left) && !/^\s/.test(typed)) side = 'left';
    else if (word(right) && !/\s$/.test(typed)) side = 'right';
    else side = right.depth < left.depth ? 'right' : 'left';
    const near = side === 'left' ? left! : right!;
    const other = side === 'left' ? right : left;
    let at = side === 'left' ? near.to : near.from;
    const joins = side === 'left' ? word(near) && !/^\s/.test(typed) : word(near) && !/\s$/.test(typed);
    if (!joins) {
      const within = (u: Unit | undefined, pr: Pair) => !!u && u.from >= pr.open[1] && u.to <= pr.close[0];
      for (let moved = true; moved; ) {
        moved = false;
        for (const pr of projected.pairs) {
          if (side === 'left' && at === pr.close[0] && !within(other, pr)) {
            at = pr.close[1];
            moved = true;
          } else if (side === 'right' && at === pr.open[1] && !within(other, pr)) {
            at = pr.open[0];
            moved = true;
          }
        }
      }
    }
    from = to = at;
    code = projected.pairs.some((pr) => pr.kind === 'code' && at >= pr.open[1] && at <= pr.close[0]);
  } else {
    const changed = units.slice(p, removedEnd);
    if (changed.some((u) => u.kind === 'atomic')) return { error: `The change touches a variable, footnote or special character. ${EDITOR_HINT}` };
    from = changed[0].from;
    to = changed[changed.length - 1].to;
    code = changed.every((u) => u.kind === 'code');
    if (!typed) {
      // Deleting all the text of a bold word, link or code span deletes its markers too.
      for (let grew = true; grew; ) {
        grew = false;
        for (const pr of projected.pairs) {
          if (from <= pr.open[1] && to >= pr.close[0] && (from > pr.open[0] || to < pr.close[1])) {
            from = Math.min(from, pr.open[0]);
            to = Math.max(to, pr.close[1]);
            grew = true;
          }
        }
      }
    }
  }
  const inside = (r: [number, number]) => r[0] >= from && r[1] <= to && r[1] > r[0];
  const cuts = (r: [number, number]) => r[0] < to && r[1] > from && !inside(r);
  for (const pr of projected.pairs) {
    if (cuts(pr.open) || cuts(pr.close) || inside(pr.open) !== inside(pr.close)) return { error: `The change crosses formatting (bold, italics, a link or code). ${EDITOR_HINT}` };
  }
  if (projected.barriers.some((b) => b >= from && b < to)) return { error: `The change includes an image or inline HTML. ${EDITOR_HINT}` };

  let insert: string;
  if (code) {
    if (typed.includes('`')) return { error: `A backtick cannot be typed inside code here. ${EDITOR_HINT}` };
    insert = typed;
  } else {
    const atLineStart = from === 0 || block.content[from - 1] === '\n';
    insert = escapeInline(smarten(typed, before.slice(0, p)), atLineStart);
  }
  return { from: block.offsets[from], to: block.offsets[to], insert };
}
