import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockToSpans, type ContextMenuItem } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { editorExtensions } from '../editor/setup';
import { setSpans } from '../editor/authorship';
import { forgetWord, ignoreWord, misspelledAt } from '../editor/spellcheck';
import { markDirty, reportError } from '../state/actions';
import { setState, type OpenDoc } from '../state/store';

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
  items.push({ role: 'cut', label: 'Cut' }, { role: 'copy', label: 'Copy' }, { role: 'paste', label: 'Paste' }, { type: 'separator' }, { role: 'selectAll', label: 'Select All' });
  try {
    const id = await api.ui.showContextMenu(items);
    if (!id || !word) return;
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

export function Editor({ doc }: { doc: OpenDoc }) {
  const host = useRef<HTMLDivElement>(null);

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
    updateStats(view.state);
    view.focus();
    return () => {
      editorBridge.attach(null);
      view.destroy();
    };
    // Recreate only when a different file (or a reload from disk) is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, doc.loadId]);

  return <div className={`editor-host editor-${doc.kind}`} ref={host} />;
}
