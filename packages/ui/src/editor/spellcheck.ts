// Spelling underlines using the platform spellchecker (macOS: the system dictionary).
// Words in code, URLs, HTML, front matter, content block paths and {{variables}} are skipped.

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { frontMatterRange, isContentBlockLine } from '@mde/core';

export interface SpellService {
  check(words: string[]): Promise<string[]>;
}

const SKIP_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'URL', 'HTMLTag', 'HTMLBlock', 'Comment', 'CommentBlock', 'Autolink', 'LinkLabel', 'ProcessingInstruction']);
const WORD = /[\p{L}][\p{L}\p{M}'’]*/gu;

const misspelled = new Map<string, boolean>();
const ignored = new Set<string>();

const refresh = StateEffect.define<null>();
export const spellEnabled = StateField.define<boolean>({ create: () => true, update: (v) => v });

const mark = Decoration.mark({ class: 'cm-misspelled' });

function skipRanges(state: EditorState, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (SKIP_NODES.has(n.name)) {
        out.push([n.from, n.to]);
        return false;
      }
      return undefined;
    },
  });
  return out;
}

interface Found {
  word: string;
  from: number;
  to: number;
}

function collect(view: EditorView): Found[] {
  const { state } = view;
  const fm = frontMatterRange(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
  const found: Found[] = [];
  for (const { from, to } of view.visibleRanges) {
    const skips = skipRanges(state, from, to);
    let line = state.doc.lineAt(from);
    while (true) {
      if (!(fm && line.from < fm[1]) && !isContentBlockLine(line.text)) {
        const text = line.text;
        const vars: Array<[number, number]> = [];
        for (const m of text.matchAll(/\{\{[^{}\n]*\}\}|https?:\/\/\S+|\S+@\S+\.\S+/g)) vars.push([m.index!, m.index! + m[0].length]);
        for (const m of text.matchAll(WORD)) {
          let w = m[0].replace(/['’]+$/, '');
          const start = line.from + m.index!;
          const end = start + w.length;
          if (w.length < 2 || /\d/.test(text[m.index! + m[0].length] ?? '') || /\d/.test(text[m.index! - 1] ?? '')) continue;
          if (w === w.toUpperCase()) continue; // acronyms
          if (vars.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
          if (skips.some(([a, b]) => start >= a && start < b)) continue;
          w = w.replace(/’/g, "'");
          found.push({ word: w, from: start, to: end });
        }
      }
      if (line.to >= to || line.number === state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return found;
}

export function spellcheck(service: SpellService) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      timer: ReturnType<typeof setTimeout> | null = null;
      constructor(readonly view: EditorView) {
        this.schedule(50);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = this.decorations.map(u.changes);
        if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.schedule(400);
      }
      schedule(ms: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.run(), ms);
      }
      async run() {
        this.timer = null;
        if (!this.view.state.field(spellEnabled, false)) {
          this.decorations = Decoration.none;
          return;
        }
        const found = collect(this.view);
        const unknown = [...new Set(found.map((f) => f.word))].filter((w) => !misspelled.has(w));
        if (unknown.length) {
          try {
            const bad = new Set(await service.check(unknown));
            for (const w of unknown) misspelled.set(w, bad.has(w));
          } catch {
            return;
          }
        }
        const builder = new RangeSetBuilder<Decoration>();
        const docLen = this.view.state.doc.length;
        for (const f of found) if (misspelled.get(f.word) && !ignored.has(f.word) && f.to <= docLen) builder.add(f.from, f.to, mark);
        this.decorations = builder.finish();
        this.view.dispatch({ effects: [] });
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [spellEnabled, plugin];
}

/** Misspelled word at a position, if any. */
export function misspelledAt(view: EditorView, pos: number): { word: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WORD)) {
    const w = m[0].replace(/['’]+$/, '');
    const from = line.from + m.index!;
    const to = from + w.length;
    if (pos >= from && pos <= to) {
      const key = w.replace(/’/g, "'");
      return misspelled.get(key) && !ignored.has(key) ? { word: key, from, to } : null;
    }
  }
  return null;
}

export function ignoreWord(view: EditorView, word: string): void {
  ignored.add(word);
  view.dispatch({ effects: refresh.of(null) });
}

export function forgetWord(word: string): void {
  misspelled.set(word, false);
}
