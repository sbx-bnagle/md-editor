import { useEffect, useRef, useState } from 'react';
import { parseReply, resolveEditPath, type ChatTurn, type EditPair, type PairStatus } from '@mde/core';
import { insertAiText, providerReady } from '../ai/actions';
import { chatRootFor, clearChat, loadChat, sendChat, stopChat, type ChatRoot } from '../ai/chat';
import { applyEdit, createFile, createStatus, editStatus, type FileStatus } from '../ai/edits';
import { openFile } from '../state/actions';
import { editorBridge } from '../editor/bridge';
import { getState, setState, useStore } from '../state/store';
import { ReferencesSection } from './References';

interface ReplyContext {
  /** Folder the chat belongs to; file paths in changes are relative to it. */
  root: string;
  model: string;
  /** The message the reply answers (logged with applied AI text). */
  prompt: string;
  /** Bumped after a change is applied, so statuses are checked again. */
  version: number;
  onApplied: () => void;
}

/** The Document and Project files choices, kept while the app runs (the panel is unmounted when another one is shown). */
const sendChoices = { includeDoc: true, includeProject: true };

/** Tells the reply whether a block has something left to apply. */
type OnReady = (ready: boolean) => void;

const PAIR_LABEL: Record<PairStatus, string> = { ready: '', applied: 'Applied', missing: 'Not found in the file', ambiguous: 'Found in more than one place' };

/** A proposed change to part of a file: before and after, with Apply. */
function EditBlock({ file, pairs, complete, ctx, onReady }: { file: string; pairs: EditPair[]; complete: boolean; ctx: ReplyContext; onReady: OnReady }) {
  const [status, setStatus] = useState<{ file?: FileStatus; pairs: PairStatus[] } | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!complete) return;
    editStatus(ctx.root, file, pairs).then((s) => {
      setStatus(s);
      onReady(s.pairs.includes('ready'));
    });
  }, [complete, ctx.root, ctx.version, file, pairs.length]);
  const ready = status?.pairs.filter((p) => p === 'ready').length ?? 0;
  const summary = !complete
    ? 'Writing…'
    : status?.file === 'outside'
      ? 'Outside the project; not applied'
      : status?.file === 'missing-file'
        ? 'File not found'
        : status && status.pairs.length && status.pairs.every((p) => p === 'applied')
          ? 'Applied'
          : status && ready < status.pairs.length
            ? `${status.pairs.length - ready} of ${status.pairs.length} cannot be applied`
            : '';
  const apply = async () => {
    setWorking(true);
    await applyEdit(ctx.root, file, pairs, ctx);
    setWorking(false);
    ctx.onApplied();
  };
  const path = resolveEditPath(ctx.root, file);
  return (
    <div className="chat-edit">
      <div className="chat-edit-head">
        {path ? (
          <button className="link-button" onClick={() => openFile(path, { newTab: true })} title={`Open ${file}`}>
            {file}
          </button>
        ) : (
          <span>{file || 'No file named'}</span>
        )}
        {summary && <span className="chat-edit-status">{summary}</span>}
      </div>
      {pairs.map((p, i) => (
        <div key={i} className={`chat-edit-pair${status?.pairs[i] && status.pairs[i] !== 'ready' ? ` ${status.pairs[i]}` : ''}`} title={status?.pairs[i] ? PAIR_LABEL[status.pairs[i]] : undefined}>
          {p.search && (
            <div className="chat-edit-old" aria-label="Current text">
              {p.search}
            </div>
          )}
          <div className="chat-edit-new" aria-label={p.search ? 'Replaced by' : 'New text'}>
            {p.replace || <em>Deleted</em>}
          </div>
        </div>
      ))}
      {complete && (
        <div className="chat-insert-actions">
          <button className="button small" onClick={apply} disabled={working || !ready}>
            {pairs.length === 1 ? 'Apply' : ready === pairs.length ? 'Apply All Changes' : `Apply ${ready} Change${ready === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** A proposed new file, with Create File. */
function CreateBlock({ file, content, complete, ctx, onReady }: { file: string; content: string; complete: boolean; ctx: ReplyContext; onReady: OnReady }) {
  const [status, setStatus] = useState<FileStatus | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!complete) return;
    createStatus(ctx.root, file).then((s) => {
      setStatus(s);
      onReady(s === 'ready');
    });
  }, [complete, ctx.root, ctx.version, file]);
  const summary = !complete ? 'Writing…' : status === 'outside' ? 'Outside the project; not created' : status === 'created' ? 'Created' : status === 'exists' ? 'A file with this name exists' : '';
  return (
    <div className="chat-edit">
      <div className="chat-edit-head">
        <span>New file: {file}</span>
        {summary && <span className="chat-edit-status">{summary}</span>}
      </div>
      <div className="chat-edit-pair">
        <div className="chat-edit-new chat-edit-file">{content}</div>
      </div>
      {complete && (
        <div className="chat-insert-actions">
          <button
            className="button small"
            disabled={working || status !== 'ready'}
            onClick={async () => {
              setWorking(true);
              await createFile(ctx.root, file, content, ctx);
              setWorking(false);
              ctx.onApplied();
            }}
          >
            Create File
          </button>
        </div>
      )}
    </div>
  );
}

function Reply({ turn, ctx, onInsert }: { turn: ChatTurn; ctx: ReplyContext | null; onInsert: (text: string, replace: boolean) => void }) {
  const segments = parseReply(turn.content);
  const hasSelection = !!editorBridge.view && !editorBridge.view.state.selection.main.empty;
  const changes = segments.filter((s) => (s.type === 'edit' || s.type === 'create') && s.complete);
  const [working, setWorking] = useState(false);
  // Blocks (by index) that have something left to apply.
  const [ready, setReady] = useState<Record<number, boolean>>({});
  const readyCount = Object.values(ready).filter(Boolean).length;
  const onReady = (i: number) => (r: boolean) => setReady((m) => (m[i] === r ? m : { ...m, [i]: r }));
  const applyAll = async () => {
    if (!ctx) return;
    setWorking(true);
    for (const [i, s] of segments.entries()) {
      if (!ready[i]) continue;
      if (s.type === 'edit') await applyEdit(ctx.root, s.file, s.pairs, ctx);
      else if (s.type === 'create' && (await createStatus(ctx.root, s.file)) === 'ready') await createFile(ctx.root, s.file, s.content, ctx);
    }
    setWorking(false);
    ctx.onApplied();
  };
  return (
    <div className={`chat-turn ${turn.role}${turn.error ? ' error' : ''}`}>
      {segments.map((s, i) => {
        if (s.type === 'text') return <div key={i} className="chat-text">{s.text}</div>;
        if (s.type === 'edit') return ctx ? <EditBlock key={i} file={s.file} pairs={s.pairs} complete={s.complete} ctx={ctx} onReady={onReady(i)} /> : null;
        if (s.type === 'create') return ctx ? <CreateBlock key={i} file={s.file} content={s.content} complete={s.complete} ctx={ctx} onReady={onReady(i)} /> : null;
        return (
          <div key={i} className="chat-insert">
            <div className="chat-insert-text">{s.text}</div>
            {s.complete && (
              <div className="chat-insert-actions">
                <button className="button small" onClick={() => onInsert(s.text, false)}>
                  Insert at cursor
                </button>
                {hasSelection && (
                  <button className="button small" onClick={() => onInsert(s.text, true)}>
                    Replace selection
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {ctx && changes.length > 1 && readyCount > 0 && (
        <div className="chat-apply-all">
          <button className="button small primary" onClick={applyAll} disabled={working}>
            Apply All ({readyCount})
          </button>
        </div>
      )}
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
  const [includeDoc, setIncludeDoc] = useState(sendChoices.includeDoc);
  const [includeProject, setIncludeProject] = useState(sendChoices.includeProject);
  const [version, setVersion] = useState(0);
  const lastSaved = useStore((s) => s.lastSaved);
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
    sendChat(root.path, text, { includeDoc, includeProject });
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
            <div className="panel-empty">Ask about the document, ask for a draft, or ask for changes to the project's files. Drafts come with buttons to insert them; changes with buttons to apply them. The conversation is kept with {root?.name ?? 'the project'}.</div>
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
            const model = t.model ?? provider?.model ?? 'ai';
            const prompt = turns.slice(0, i).filter((u) => u.role === 'user').at(-1)?.content ?? '';
            const ctx = root && !t.error ? { root: root.path, model, prompt, version: version + (lastSaved ?? 0), onApplied: () => setVersion((v) => v + 1) } : null;
            return <Reply key={i} turn={t.content ? t : { ...t, content: busy && i === turns.length - 1 ? '…' : t.content }} ctx={ctx} onInsert={(text, replace) => insert(text, replace, model)} />;
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
            <input type="checkbox" checked={includeDoc} onChange={(e) => setIncludeDoc((sendChoices.includeDoc = e.target.checked))} />
            Document
          </label>
          {doc?.projectPath && (
            <label className="checkbox-row inline" title="Send the project's other markdown files, so the Assistant can read them and propose changes to them">
              <input type="checkbox" checked={includeProject} onChange={(e) => setIncludeProject((sendChoices.includeProject = e.target.checked))} />
              Project files
            </label>
          )}
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
