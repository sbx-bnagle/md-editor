// Tracks iA-style authorship spans through edits so the annotation block stays valid
// when the file is saved. Text typed here is not attributed yet (iteration 2 adds
// authorship for typed and AI-generated text).

import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { AuthorSpan } from '@mde/core';

export const setSpans = StateEffect.define<AuthorSpan[]>();

export const authorSpans = StateField.define<AuthorSpan[]>({
  create: () => [],
  update(spans, tr) {
    for (const e of tr.effects) if (e.is(setSpans)) return e.value;
    if (!tr.docChanged || spans.length === 0) return spans;
    const out: AuthorSpan[] = [];
    for (const s of spans) {
      const from = tr.changes.mapPos(s.from, 1);
      const to = tr.changes.mapPos(s.to, -1);
      if (to > from) out.push({ author: s.author, from, to });
    }
    return out;
  },
});

const aiMark = Decoration.mark({ class: 'cm-ai-text' });

const authorDecorations = EditorView.decorations.compute([authorSpans], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  const spans = [...state.field(authorSpans)].filter((s) => s.author.startsWith('&')).sort((a, b) => a.from - b.from);
  for (const s of spans) builder.add(s.from, s.to, aiMark);
  return builder.finish() as DecorationSet;
});

export const authorship = [authorSpans, authorDecorations];
