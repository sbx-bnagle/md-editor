import { useEffect, useRef, useState } from 'react';
import { inlineMessages, writingSystemPrompt } from '@mde/core';
import { streamAi, type AiStream } from '../ai/client';
import { aiReferences } from '../ai/references';
import { writingContext } from '../ai/context';
import { insertAiText } from '../ai/actions';
import { editorBridge } from '../editor/bridge';
import { getState, setState, useStore } from '../state/store';

type Phase = { kind: 'idle' } | { kind: 'running'; text: string } | { kind: 'done'; text: string; model: string } | { kind: 'error'; message: string };

export function CommandBar() {
  const referenceCount = useStore((st) => st.references.items.filter((r) => r.included && !r.problem).length);
  const bar = useStore((s) => s.commandBar);
  const prefs = useStore((s) => s.prefs);
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [top, setTop] = useState(60);
  const stream = useRef<AiStream | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!bar) return;
    setPrompt('');
    setPhase({ kind: 'idle' });
    const view = editorBridge.view;
    if (view) {
      const coords = view.coordsAtPos(bar.from);
      const hostTop = view.scrollDOM.getBoundingClientRect().top;
      const y = coords ? coords.bottom - hostTop + 8 : 60;
      setTop(Math.max(12, Math.min(y, view.scrollDOM.clientHeight - 260)));
    }
    setTimeout(() => input.current?.focus(), 0);
    return () => stream.current?.cancel();
  }, [bar]);

  if (!bar) return null;
  const provider = prefs?.ai.providers.find((p) => p.id === prefs.ai.defaultProvider);

  const close = () => {
    stream.current?.cancel();
    stream.current = null;
    setState({ commandBar: null });
    editorBridge.focus();
  };

  const run = () => {
    const view = editorBridge.view;
    if (!view || !prompt.trim()) return;
    const doc = view.state.doc;
    const messages = inlineMessages({
      mode: bar.mode,
      instruction: prompt.trim(),
      before: doc.sliceString(0, bar.from),
      selection: doc.sliceString(bar.from, bar.to),
      after: doc.sliceString(bar.to),
    });
    setPhase({ kind: 'running', text: '' });
    stream.current = streamAi({ purpose: 'inline', system: writingSystemPrompt(writingContext()), messages, references: aiReferences() }, (text) => setPhase({ kind: 'running', text }));
    stream.current.result
      .then((r) => {
        if (r.refused) setPhase({ kind: 'error', message: 'The model declined this request. Try rephrasing it.' });
        else setPhase({ kind: 'done', text: r.text.replace(/^\n+|\s+$/g, ''), model: r.model });
      })
      .catch((e: unknown) => setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  const accept = () => {
    if (phase.kind !== 'done') return;
    // The document may have changed while the bar was open; positions are re-read from state.
    const current = getState().commandBar;
    if (!current) return;
    insertAiText({ from: current.from, to: current.to, text: phase.text, model: phase.model, mode: current.mode, prompt: prompt.trim() });
    setState({ commandBar: null });
  };

  return (
    <div
      className="command-bar"
      style={{ top }}
      role="dialog"
      aria-label="Ask AI"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && phase.kind === 'done') {
          e.preventDefault();
          accept();
        }
      }}
    >
      <div className="command-input-row">
        <span className="command-mode">{bar.mode === 'rewrite' ? 'Rewrite selection' : 'Write at cursor'}</span>
        <textarea
          ref={input}
          rows={1}
          value={prompt}
          placeholder={bar.mode === 'rewrite' ? 'How should it change? e.g. shorter, friendlier, as a list' : 'What should be written here?'}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
              e.preventDefault();
              run();
            }
          }}
          disabled={phase.kind === 'running'}
          spellCheck={false}
        />
      </div>
      {phase.kind === 'running' && <div className="command-output streaming">{phase.text || 'Writing…'}</div>}
      {phase.kind === 'done' && <div className="command-output">{phase.text}</div>}
      {phase.kind === 'error' && <div className="command-error" role="alert">{phase.message}</div>}
      <div className="command-actions">
        <span className="command-provider">
          {provider ? `${provider.name} · ${provider.model}` : ''}
          {referenceCount > 0 && ` · ${referenceCount} reference${referenceCount === 1 ? '' : 's'}`}
        </span>
        {phase.kind === 'running' && (
          <button className="button small" onClick={() => stream.current?.cancel()}>
            Stop
          </button>
        )}
        {(phase.kind === 'done' || phase.kind === 'error') && (
          <button className="button small" onClick={run}>
            Try again
          </button>
        )}
        <button className="button small" onClick={close}>
          Discard
        </button>
        {phase.kind === 'done' ? (
          <button className="button small primary" onClick={accept} title="⌘↩">
            {bar.mode === 'rewrite' ? 'Replace' : 'Insert'}
          </button>
        ) : (
          <button className="button small primary" onClick={run} disabled={!prompt.trim() || phase.kind === 'running'}>
            Write
          </button>
        )}
      </div>
    </div>
  );
}
