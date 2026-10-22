import { useEffect, useRef, useState } from 'react';
import { insertBlocks, type ChatTurn } from '@mde/core';
import { insertAiText, providerReady } from '../ai/actions';
import { chatRootFor, clearChat, loadChat, sendChat, stopChat, type ChatRoot } from '../ai/chat';
import { editorBridge } from '../editor/bridge';
import { getState, setState, useStore } from '../state/store';
import { ReferencesSection } from './References';

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
  const libraryRoot = useStore((s) => s.tree?.root);
  const [root, setRoot] = useState<ChatRoot | null>(null);
  const chat = useStore((s) => (root ? s.chats[root.path] : undefined));
  const turns = chat?.turns ?? [];
  const busy = !!chat?.busy;
  const [input, setInput] = useState('');
  const [includeDoc, setIncludeDoc] = useState(true);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    chatRootFor(getState().doc).then((r) => {
      if (!current) return;
      setRoot((old) => (old?.path === r?.path ? old : r));
      if (r) loadChat(r.path);
    });
    return () => {
      current = false;
    };
  }, [doc?.path, libraryRoot]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, root?.path]);

  const provider = prefs?.ai.providers.find((p) => p.id === prefs.ai.defaultProvider);
  const ready = providerReady();

  const send = () => {
    const text = input.trim();
    if (!text || busy || !root || !chat?.loaded) return;
    setInput('');
    sendChat(root.path, text, { includeDoc });
  };

  const insert = (text: string, replace: boolean, model: string) => {
    const view = editorBridge.view;
    if (!view || doc?.kind !== 'markdown') return;
    const sel = view.state.selection.main;
    insertAiText({ from: replace ? sel.from : sel.head, to: replace ? sel.to : sel.head, text, model, mode: 'chat', prompt: turns.filter((t) => t.role === 'user').at(-1)?.content ?? '' });
  };

  // The document each message was about, shown when it changes.
  let lastDoc: string | undefined;
  return (
    <div className="assistant-panel">
      <div className="assistant-scroll" ref={list}>
        {root && (
          <div className="panel-subheader">
            <span className="panel-project" title={`Saved with “${root.name}”: ${root.path}/.mdeditor/chat.json`}>
              {root.name}
            </span>
            {turns.length > 0 && (
              <button className="button small" onClick={() => clearChat(root)} disabled={busy}>
                Clear Chat…
              </button>
            )}
          </div>
        )}
        <ReferencesSection />
        {!ready && (
          <div className="panel-empty">
            No AI service is ready.{' '}
            <button className="link-button" onClick={() => setState({ settingsOpen: true })}>
              Open Settings
            </button>
          </div>
        )}
        <div className="chat-list">
          {turns.length === 0 && ready && chat?.loaded && (
            <div className="panel-empty">Ask about the document, or ask for a draft. Drafts appear with buttons to insert them. The conversation is kept with {root?.name ?? 'the project'}.</div>
          )}
          {turns.map((t, i) => {
            if (t.role === 'user') {
              const label = t.doc && t.doc !== lastDoc ? t.doc : null;
              lastDoc = t.doc ?? lastDoc;
              return (
                <div key={i} className="chat-turn-group">
                  {label && <div className="chat-doc">{label}</div>}
                  <div className="chat-turn user">
                    <div className="chat-text">{t.content}</div>
                  </div>
                </div>
              );
            }
            return <Reply key={i} turn={t.content ? t : { ...t, content: busy && i === turns.length - 1 ? '…' : t.content }} onInsert={(text, replace) => insert(text, replace, t.model ?? provider?.model ?? 'ai')} />;
          })}
        </div>
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
          {busy ? (
            <button className="button small" onClick={() => root && stopChat(root.path)}>
              Stop
            </button>
          ) : (
            <button className="button small primary" onClick={send} disabled={!input.trim() || !ready || !chat?.loaded}>
              Send
            </button>
          )}
        </div>
        <div className="chat-provider">{provider ? `${provider.name} · ${provider.model}` : ''}</div>
      </div>
    </div>
  );
}
