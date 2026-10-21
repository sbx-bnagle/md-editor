import { useEffect, useRef, useState } from 'react';
import { chatSystemPrompt, insertBlocks, type AiMessage } from '@mde/core';
import { streamAi, type AiStream } from '../ai/client';
import { refreshActiveGuides, writingContext } from '../ai/context';
import { insertAiText, providerReady } from '../ai/actions';
import { editorBridge } from '../editor/bridge';
import { aiReferences } from '../ai/references';
import { setState, useStore } from '../state/store';
import { ReferencesSection } from './References';

interface ChatTurn extends AiMessage {
  model?: string;
  error?: boolean;
}

// Conversations are kept per document for the session.
const conversations = new Map<string, ChatTurn[]>();

function Reply({ turn, onInsert }: { turn: ChatTurn; onInsert: (text: string, replace: boolean) => void }) {
  const parts = turn.content.split(/(```insert[^\n]*\n[\s\S]*?```)/g);
  const hasSelection = !!editorBridge.view && !editorBridge.view.state.selection.main.empty;
  return (
    <div className={`chat-turn ${turn.role}${turn.error ? ' error' : ''}`}>
      {parts.map((p, i) => {
        const block = insertBlocks(p)[0];
        if (block === undefined) return p.trim() ? <div key={i} className="chat-text">{p.trim()}</div> : null;
        return (
          <div key={i} className="chat-insert">
            <div className="chat-insert-text">{block}</div>
            <div className="chat-insert-actions">
              <button className="button small" onClick={() => onInsert(block, false)}>
                Insert at cursor
              </button>
              {hasSelection && (
                <button className="button small" onClick={() => onInsert(block, true)}>
                  Replace selection
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AssistantPanel() {
  const doc = useStore((s) => s.doc);
  const prefs = useStore((s) => s.prefs);
  const key = doc?.path ?? '';
  const [turns, setTurns] = useState<ChatTurn[]>(() => conversations.get(key) ?? []);
  const [input, setInput] = useState('');
  const [includeDoc, setIncludeDoc] = useState(true);
  const [busy, setBusy] = useState(false);
  const stream = useRef<AiStream | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns(conversations.get(key) ?? []);
  }, [key]);
  useEffect(() => {
    conversations.set(key, turns);
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, key]);
  useEffect(() => () => stream.current?.cancel(), []);

  const provider = prefs?.ai.providers.find((p) => p.id === prefs.ai.defaultProvider);
  const ready = providerReady();

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const history: ChatTurn[] = [...turns, { role: 'user', content: text }];
    setTurns([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    await refreshActiveGuides().catch(() => undefined);
    const view = editorBridge.view;
    const document = includeDoc && view && doc?.kind === 'markdown' ? { name: doc.name, text: view.state.doc.toString() } : null;
    const sel = view?.state.selection.main;
    const selection = view && sel && !sel.empty ? view.state.sliceDoc(sel.from, sel.to) : '';
    stream.current = streamAi(
      {
        purpose: 'chat',
        system: chatSystemPrompt(writingContext(), document, selection),
        messages: history.filter((t) => !t.error).map(({ role, content }) => ({ role, content })),
        references: aiReferences(),
      },
      (soFar) => setTurns([...history, { role: 'assistant', content: soFar }]),
    );
    try {
      const r = await stream.current.result;
      setTurns([...history, r.refused ? { role: 'assistant', content: 'The model declined this request.', error: true } : { role: 'assistant', content: r.text, model: r.model }]);
    } catch (e) {
      setTurns([...history, { role: 'assistant', content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
      stream.current = null;
    }
  };

  const insert = (text: string, replace: boolean, model: string) => {
    const view = editorBridge.view;
    if (!view || doc?.kind !== 'markdown') return;
    const sel = view.state.selection.main;
    insertAiText({ from: replace ? sel.from : sel.head, to: replace ? sel.to : sel.head, text, model, mode: 'chat', prompt: turns.filter((t) => t.role === 'user').at(-1)?.content ?? '' });
  };

  return (
    <div className="assistant-panel">
      <ReferencesSection />
      {!ready && (
        <div className="panel-empty">
          No AI service is ready.{' '}
          <button className="link-button" onClick={() => setState({ settingsOpen: true })}>
            Open Settings
          </button>
        </div>
      )}
      <div className="chat-list" ref={list}>
        {turns.length === 0 && ready && <div className="panel-empty">Ask about the document, or ask for a draft. Drafts appear with buttons to insert them.</div>}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="chat-turn user">
              <div className="chat-text">{t.content}</div>
            </div>
          ) : (
            <Reply key={i} turn={t.content ? t : { ...t, content: busy && i === turns.length - 1 ? '…' : t.content }} onInsert={(text, replace) => insert(text, replace, t.model ?? provider?.model ?? 'ai')} />
          ),
        )}
      </div>
      <div className="chat-compose">
        <textarea
          value={input}
          rows={3}
          placeholder={doc?.kind === 'markdown' ? `Message about ${doc.name}…` : 'Message…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={!ready}
        />
        <div className="chat-compose-row">
          <label className="checkbox-row inline">
            <input type="checkbox" checked={includeDoc} onChange={(e) => setIncludeDoc(e.target.checked)} />
            Include document
          </label>
          <span className="spacer" />
          {turns.length > 0 && (
            <button className="button small" onClick={() => setTurns([])} disabled={busy}>
              New chat
            </button>
          )}
          {busy ? (
            <button className="button small" onClick={() => stream.current?.cancel()}>
              Stop
            </button>
          ) : (
            <button className="button small primary" onClick={send} disabled={!input.trim() || !ready}>
              Send
            </button>
          )}
        </div>
        <div className="chat-provider">{provider ? `${provider.name} · ${provider.model}` : ''}</div>
      </div>
    </div>
  );
}
