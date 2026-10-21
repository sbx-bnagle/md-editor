import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockToSpans, humanAuthorKey, replacements, thesaurusQuery, topSynonyms, type ContextMenuItem, type SensePos, type ThesaurusResult } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { editorExtensions } from '../editor/setup';
import { setHumanAuthor, setSpans } from '../editor/authorship';
import { setChecksConfig } from '../editor/checks';
import { forgetWord, ignoreWord, misspelledAt, setSpellEnabled } from '../editor/spellcheck';
import { markDirty, reportError } from '../state/actions';
import { getState, setState, useStore, type OpenDoc } from '../state/store';

function countWords(text: string): number {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

let statsTimer: ReturnType<typeof setTimeout> | null = null;
function updateStats(state: EditorState) {
  if (statsTimer) clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    const text = state.doc.toString();
    setState({ stats: { words: countWords(text), chars: text.length } });
  }, 250);
}

const POS_LABEL: Record<SensePos, string> = { noun: 'noun', verb: 'verb', adjective: 'adj.', adverb: 'adv.' };

/** The selected word or phrase (trimmed of surrounding punctuation) and the sentence around it. */
function selectedTerm(view: EditorView): { from: number; to: number; query: string; context: string } | null {
  const sel = view.state.selection.main;
  if (sel.empty || sel.to - sel.from > 80) return null;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const query = thesaurusQuery(text);
  if (!query) return null;
  const lead = text.length - text.trimStart().replace(/^[^\p{L}\p{N}]+/u, '').length;
  const trail = text.length - text.trimEnd().replace(/[^\p{L}\p{N}]+$/u, '').length;
  const line = view.state.doc.lineAt(sel.from);
  return { from: sel.from + lead, to: sel.to - trail, query, context: line.text.slice(0, 400) };
}

/** Thesaurus items: a few synonyms inline, then a submenu per sense. Ids are "th:<word>". */
function thesaurusItems(result: ThesaurusResult): ContextMenuItem[] {
  const word = (w: string): ContextMenuItem => ({ id: `th:${w}`, label: w });
  const top = topSynonyms(result);
  const senses = result.senses.map((s): ContextMenuItem => {
    const groups: Array<[string, string[]]> = [
      ['Synonyms', replacements(s)],
      ['More general', s.broader],
      ...(s.pos === 'noun' ? ([['More specific', s.narrower]] as Array<[string, string[]]>) : []),
    ];
    const submenu: ContextMenuItem[] = [];
    for (const [label, words] of groups) {
      if (!words.length) continue;
      if (submenu.length) submenu.push({ type: 'separator' });
      submenu.push({ label, enabled: false }, ...words.slice(0, 12).map(word));
    }
    return { label: `${POS_LABEL[s.pos]} ${s.gloss}`, submenu };
  });
  return [
    { label: `Synonyms for “${result.word}”`, enabled: false },
    ...(top.length ? top.map(word) : [{ label: 'No close synonyms', enabled: false }]),
    { label: 'Thesaurus', submenu: senses },
    { type: 'separator' },
  ];
}

async function showContextMenu(view: EditorView, event: MouseEvent) {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const word = pos === null ? null : misspelledAt(view, pos);
  const items: ContextMenuItem[] = [];
  let suggestions: string[] = [];
  if (word) {
    suggestions = (await api.spell.suggest(word.word)).slice(0, 6);
    if (suggestions.length) suggestions.forEach((s, i) => items.push({ id: `s${i}`, label: s }));
    else items.push({ label: 'No Guesses Found', enabled: false });
    items.push({ type: 'separator' }, { id: 'learn', label: 'Learn Spelling' }, { id: 'ignore', label: 'Ignore Spelling' }, { type: 'separator' });
  }
  const term = getState().doc?.kind === 'markdown' ? selectedTerm(view) : null;
  if (term) {
    const spelling = getState().activeGuides.style?.settings.spelling;
    const result = await api.thesaurus.lookup(term.query, { context: term.context, spelling: spelling === 'uk' || spelling === 'oxford' ? 'uk' : 'us' }).catch(() => null);
    if (result) items.push(...thesaurusItems(result));
  }
  items.push({ role: 'cut', label: 'Cut' }, { role: 'copy', label: 'Copy' }, { role: 'paste', label: 'Paste' }, { type: 'separator' }, { role: 'selectAll', label: 'Select All' });
  try {
    const id = await api.ui.showContextMenu(items);
    if (!id) return;
    if (id.startsWith('th:') && term) {
      // Typographic apostrophes, as typing would produce.
      const insert = id.slice(3).replace(/'/g, '’');
      view.dispatch({ changes: { from: term.from, to: term.to, insert }, selection: { anchor: term.from, head: term.from + insert.length }, userEvent: 'input.thesaurus' });
      view.focus();
      return;
    }
    if (!word) return;
    if (id.startsWith('s')) {
      const replacement = suggestions[Number(id.slice(1))];
      view.dispatch({ changes: { from: word.from, to: word.to, insert: replacement }, userEvent: 'input.spell' });
    } else if (id === 'learn') {
      await api.spell.learn(word.word);
      forgetWord(word.word);
      ignoreWord(view, word.word);
    } else if (id === 'ignore') ignoreWord(view, word.word);
  } catch (e) {
    reportError(e);
  }
}

function applyConfig(view: EditorView | null) {
  const { prefs, activeGuides } = getState();
  if (!prefs) return;
  if (view) view.dispatch({ effects: setHumanAuthor.of(prefs.recordAuthorship ? humanAuthorKey(prefs.authorName) : null) });
  setSpellEnabled(view, prefs.checks.spelling);
  setChecksConfig(view, {
    grammar: prefs.checks.grammar,
    styleOn: prefs.checks.style,
    style: activeGuides.style,
    readability: prefs.checks.readability,
    readingGrade: prefs.readingGrade,
    onCounts: (c) => setState((s) => ({ issueCounts: { ...s.issueCounts, ...c } })),
  });
}

export function Editor({ doc }: { doc: OpenDoc }) {
  const host = useRef<HTMLDivElement>(null);
  const prefs = useStore((s) => s.prefs);
  const style = useStore((s) => s.activeGuides.style);

  useEffect(() => {
    applyConfig(getState().doc?.kind === 'markdown' ? editorBridge.view : null);
  }, [prefs, style]);

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: doc.initialText,
      extensions: editorExtensions({
        kind: doc.kind,
        spell: api.spell,
        onChange: (s) => {
          markDirty();
          updateStats(s);
        },
        onContextMenu: (view, e) => {
          showContextMenu(view, e);
        },
      }),
    });
    const view = new EditorView({ state, parent: host.current });
    if (doc.kind === 'markdown' && doc.annotations) {
      view.dispatch({ effects: setSpans.of(blockToSpans(doc.initialText, doc.annotations)) });
    }
    editorBridge.attach(view);
    applyConfig(doc.kind === 'markdown' ? view : null);
    updateStats(view.state);
    view.focus();
    return () => {
      editorBridge.attach(null);
      view.destroy();
    };
    // Recreate only when a different file (or a reload from disk) is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, doc.loadId]);

  return <div className={`editor-host editor-${doc.kind}${prefs && !prefs.showAuthorship ? ' authorship-hidden' : ''}`} ref={host} />;
}
