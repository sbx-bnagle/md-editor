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

/** The change that toggles a format on every selection. */
export function formatChange(state: EditorState, kind: FormatKind): TransactionSpec {
  const marker = MARKER[kind];
  const n = marker.length;
  const tr = state.changeByRange((range) => {
    let { from, to } = range;
    const cursor = range.empty;
    if (cursor) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
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
