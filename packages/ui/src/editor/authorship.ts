// Authorship spans (iA Markdown Annotations) kept in step with edits.
//
// - Typed text is attributed to the human author (Settings › Author name).
// - Text inserted by the AI command bar or chat is attributed to the AI model.
// - Pasted and dropped text is left unattributed: its author is unknown.
// - Undo and redo restore the attribution of text they bring back.

import { Annotation, RangeSetBuilder, StateEffect, StateField, type Transaction } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { AuthorSpan } from '@mde/core';

export const setSpans = StateEffect.define<AuthorSpan[]>();
export const setHumanAuthor = StateEffect.define<string | null>();
/** Attach to a transaction that inserts AI-generated text; value is the author key, e.g. "&claude-sonnet-4-5". */
export const aiAuthor = Annotation.define<string>();

const restoreSpans = StateEffect.define<AuthorSpan[]>({
  map: (spans, mapping) =>
    spans
      .map((s) => ({ author: s.author, from: mapping.mapPos(s.from, 1), to: mapping.mapPos(s.to, -1) }))
      .filter((s) => s.to > s.from),
});

export const humanAuthor = StateField.define<string | null>({
  create: () => null,
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setHumanAuthor)) return e.value;
    return v;
  },
});

/** Removes [a, b) from every span. */
function cut(spans: AuthorSpan[], a: number, b: number): AuthorSpan[] {
  const out: AuthorSpan[] = [];
  for (const s of spans) {
    if (s.to <= a || s.from >= b) out.push(s);
    else {
      if (s.from < a) out.push({ author: s.author, from: s.from, to: a });
      if (s.to > b) out.push({ author: s.author, from: b, to: s.to });
    }
  }
  return out;
}

/** Sorts and joins touching spans of the same author. */
export function normalize(spans: AuthorSpan[]): AuthorSpan[] {
  const sorted = spans.filter((s) => s.to > s.from).sort((x, y) => x.from - y.from || x.to - y.to);
  const out: AuthorSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.author === s.author && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

function authorFor(tr: Transaction, human: string | null): string | null {
  const ai = tr.annotation(aiAuthor);
  if (ai) return ai;
  if (tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop') || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return null;
  if (tr.isUserEvent('input')) return human;
  return null;
}

export const authorSpans = StateField.define<AuthorSpan[]>({
  create: () => [],
  update(spans, tr) {
    for (const e of tr.effects) if (e.is(setSpans)) return normalize(e.value);
    if (!tr.docChanged) return spans;
    let out: AuthorSpan[] = [];
    for (const s of spans) {
      const from = tr.changes.mapPos(s.from, 1);
      const to = tr.changes.mapPos(s.to, -1);
      if (to > from) out.push({ author: s.author, from, to });
    }
    const author = authorFor(tr, tr.startState.field(humanAuthor, false) ?? null);
    // Bulk quote/dash conversion keeps the author of the characters it replaces.
    const keepAuthor = tr.isUserEvent('input.quotes');
    tr.changes.iterChanges((fromA, _ta, fromB, toB) => {
      if (toB <= fromB) return;
      out = cut(out, fromB, toB);
      const who = keepAuthor ? (spans.find((s) => s.from <= fromA && s.to > fromA)?.author ?? null) : author;
      if (who) out.push({ author: who, from: fromB, to: toB });
    });
    for (const e of tr.effects) if (e.is(restoreSpans)) for (const s of e.value) out = [...cut(out, s.from, s.to), s];
    return normalize(out);
  },
});

/** When text with authorship is deleted, undo puts the authorship back with the text. */
const keepOnUndo = invertedEffects.of((tr) => {
  if (!tr.docChanged) return [];
  const spans = tr.startState.field(authorSpans, false) ?? [];
  const removed: AuthorSpan[] = [];
  tr.changes.iterChangedRanges((fromA, toA) => {
    for (const s of spans) {
      const from = Math.max(s.from, fromA);
      const to = Math.min(s.to, toA);
      if (to > from) removed.push({ author: s.author, from, to });
    }
  });
  return removed.length ? [restoreSpans.of(removed)] : [];
});

const aiMark = Decoration.mark({ class: 'cm-ai-text', attributes: { title: 'AI-generated' } });

const authorDecorations = EditorView.decorations.compute([authorSpans], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const s of state.field(authorSpans)) if (s.author.startsWith('&')) builder.add(s.from, s.to, aiMark);
  return builder.finish() as DecorationSet;
});

export const authorship = [humanAuthor, authorSpans, keepOnUndo, authorDecorations];

export function hasAiText(spans: AuthorSpan[]): boolean {
  return spans.some((s) => s.author.startsWith('&'));
}
