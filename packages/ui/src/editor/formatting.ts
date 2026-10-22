// Bold (**), italic (*) and marked (==) text: ⌘B, ⌘I and ⌘M toggle the markers around each
// selection. A cursor inside a word formats the word; a cursor elsewhere gets a pair of markers
// to type between. Text that already has the markers (inside or just outside the selection) loses
// them, so a second press undoes the first. Asterisks are counted, so bold and italic combine
// (***both***) and come off separately.

import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type FormatKind = 'bold' | 'italic' | 'mark';

const MARKER: Record<FormatKind, string> = { bold: '**', italic: '*', mark: '==' };

/** Whether a run of marker characters on one side carries this format. */
function carries(kind: FormatKind, run: number): boolean {
  if (kind === 'italic') return run === 1 || run >= 3;
  return run >= 2;
}

interface Layer {
  ch: string;
  len: number;
  /** Distance from the starting position to the side of the run nearer to it. */
  offset: number;
}

/**
 * Runs of marker characters (* and =) from `pos` going forward (1) or back (-1), nearest first:
 * before "***==word", going back from "word", they are == then ***.
 */
function layers(state: EditorState, pos: number, dir: 1 | -1, limit: number): Layer[] {
  const out: Layer[] = [];
  let offset = 0;
  while (offset < limit) {
    const at = dir === 1 ? pos + offset : pos - offset - 1;
    const ch = at >= 0 && at < state.doc.length ? state.sliceDoc(at, at + 1) : '';
    if (ch !== '*' && ch !== '=') break;
    const last = out[out.length - 1];
    if (last && last.ch === ch) last.len++;
    else out.push({ ch, len: 1, offset });
    offset++;
  }
  return out;
}

/** The pair of runs, one on each side, that carries this format: the same layer on both sides. */
function findPair(kind: FormatKind, a: Layer[], b: Layer[]): [Layer, Layer] | null {
  const ch = MARKER[kind][0];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].ch !== b[i].ch) return null;
    if (a[i].ch === ch && carries(kind, a[i].len) && carries(kind, b[i].len)) return [a[i], b[i]];
  }
  return null;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** The word around a cursor, with apostrophes and hyphens between letters (don’t, well-known). */
function wordAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const joins = (i: number) => /['’-]/.test(text[i]) && WORD_CHAR.test(text[i - 1] ?? '') && WORD_CHAR.test(text[i + 1] ?? '');
  let a = pos - line.from;
  let b = a;
  while (a > 0 && (WORD_CHAR.test(text[a - 1]) || joins(a - 1))) a--;
  while (b < text.length && (WORD_CHAR.test(text[b]) || joins(b))) b++;
  return a === b ? null : { from: line.from + a, to: line.from + b };
}

/**
 * A span with this format on the line, around [from, to] but not right next to it (the selection
 * is part of its text): where its opening and closing markers start. Only spans whose marker runs
 * are exactly this format's markers are found.
 */
function enclosingSpan(state: EditorState, kind: FormatKind, from: number, to: number): { open: number; close: number } | null {
  const line = state.doc.lineAt(from);
  if (to > line.to) return null;
  const text = line.text;
  const n = MARKER[kind].length;
  const ch = MARKER[kind][0];
  const runs: Array<{ at: number; len: number }> = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] !== ch) {
      i++;
      continue;
    }
    let j = i;
    while (text[j] === ch) j++;
    runs.push({ at: i, len: j - i });
    i = j;
  }
  const a = from - line.from;
  const b = to - line.from;
  const opens = (r: { at: number; len: number }) => r.len === n && !/\s/.test(text[r.at + r.len] ?? ' ');
  const closes = (r: { at: number; len: number }) => r.len === n && !/\s/.test(text[r.at - 1] ?? ' ');
  const before = runs.filter((r) => r.at + r.len <= a);
  const left = before[before.length - 1];
  const right = runs.find((r) => r.at >= b);
  if (!left || !right || !opens(left) || !closes(right)) return null;
  return { open: line.from + left.at, close: line.from + right.at };
}

/** The change that toggles a format on every selection. */
export function formatChange(state: EditorState, kind: FormatKind): TransactionSpec {
  const marker = MARKER[kind];
  const n = marker.length;
  const tr = state.changeByRange((range) => {
    let { from, to } = range;
    const cursor = range.empty;
    if (cursor) {
      const word = wordAround(state, from);
      if (word) ({ from, to } = word);
    } else {
      // Markers go around the text: spaces at the ends of the selection stay outside (**word **does not work).
      while (from < to && /\s/.test(state.sliceDoc(from, from + 1))) from++;
      while (to > from && /\s/.test(state.sliceDoc(to - 1, to))) to--;
    }
    const head = range.head;
    // Markers outside the selection (possibly beyond other markers): remove them.
    const outside = findPair(kind, layers(state, from, -1, 12), layers(state, to, 1, 12));
    if (outside) {
      const [left, right] = outside;
      return {
        changes: [
          { from: from - left.offset - n, to: from - left.offset },
          { from: to + right.offset, to: to + right.offset + n },
        ],
        range: cursor ? EditorSelection.cursor(head - n) : EditorSelection.range(from - n, to - n),
      };
    }
    // Markers inside the selection, at its ends: remove them.
    const inside = cursor ? null : findPair(kind, layers(state, from, 1, Math.floor((to - from) / 2)), layers(state, to, -1, Math.floor((to - from) / 2)));
    if (inside) {
      const [left, right] = inside;
      return {
        changes: [
          { from: from + left.offset, to: from + left.offset + n },
          { from: to - right.offset - n, to: to - right.offset },
        ],
        range: EditorSelection.range(from, to - 2 * n),
      };
    }
    // Part of a longer span with the format: that part loses it (**a b c** with b selected gives **a** b **c**).
    const span = from < to ? enclosingSpan(state, kind, from, to) : null;
    if (span) {
      const changes: Array<{ from: number; to?: number; insert?: string }> = [];
      let shift = n;
      if (from === span.open + n) {
        changes.push({ from: span.open, to: span.open + n });
        shift = -n;
      } else {
        let p = from;
        while (p > span.open + n && /\s/.test(state.sliceDoc(p - 1, p))) p--;
        changes.push({ from: p, insert: marker });
      }
      if (to === span.close) changes.push({ from: span.close, to: span.close + n });
      else {
        let q = to;
        while (q < span.close && /\s/.test(state.sliceDoc(q, q + 1))) q++;
        changes.push({ from: q, insert: marker });
      }
      return { changes, range: cursor ? EditorSelection.cursor(head + shift) : EditorSelection.range(from + shift, to + shift) };
    }
    // Add them.
    if (from === to) return { changes: { from, insert: marker + marker }, range: EditorSelection.cursor(from + n) };
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: cursor ? EditorSelection.cursor(head + n) : EditorSelection.range(from + n, to + n),
    };
  });
  return { ...tr, scrollIntoView: true, userEvent: 'input.format' };
}

export function toggleFormat(view: EditorView, kind: FormatKind): boolean {
  view.dispatch(view.state.update(formatChange(view.state, kind)));
  return true;
}
