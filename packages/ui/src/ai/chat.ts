// Assistant conversations: one per project; for files outside projects, one per library folder
// (Themes, Guides), as for version history; with no document open, one for the library. Each is
// saved in that folder's .mdeditor/chat.json after every message and reply, and loaded when it is
// first shown. A reply keeps streaming into its own conversation when another tab is shown.

import { CHAT_FILE, META_DIR, chatMessagesForRequest, chatSystemPrompt, paths, type ChatTurn } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { getState, setState, toast, type ChatState, type OpenDoc } from '../state/store';
import { streamAi, type AiStream } from './client';
import { refreshActiveGuides, writingContext } from './context';
import { aiReferences } from './references';

export interface ChatRoot {
  path: string;
  name: string;
}

export async function chatRootFor(doc: OpenDoc | null): Promise<ChatRoot | null> {
  if (doc?.projectPath) return { path: doc.projectPath, name: paths.basename(doc.projectPath) };
  if (doc) {
    const root = await api.history.rootFor(doc.path).catch(() => null);
    if (root) return { path: root.path, name: root.name };
  }
  const library = getState().tree?.root;
  return library ? { path: library, name: 'Library' } : null;
}

const EMPTY: ChatState = { turns: [], loaded: false, busy: false };
const streams = new Map<string, AiStream>();

function update(root: string, patch: Partial<ChatState>): void {
  setState((s) => ({ chats: { ...s.chats, [root]: { ...(s.chats[root] ?? EMPTY), ...patch } } }));
}

function save(root: string, turns: ChatTurn[]): void {
  api.chats.save(root, turns).catch((e) => toast(`The chat could not be saved: ${e instanceof Error ? e.message : String(e)}`, 'error'));
}

export async function loadChat(root: string): Promise<void> {
  if (getState().chats[root]?.loaded) return;
  const turns = await api.chats.load(root).catch(() => [] as ChatTurn[]);
  if (!getState().chats[root]?.loaded) update(root, { turns, loaded: true });
}

/**
 * Sends a message in a conversation and streams the reply into it. With `includeProject`, the
 * project's other markdown files are attached, so the Assistant can propose changes to them.
 */
export async function sendChat(root: string, text: string, opts: { includeDoc: boolean; includeProject: boolean }): Promise<void> {
  const chat = getState().chats[root];
  if (!chat?.loaded || chat.busy) return;
  // What the request is about is taken now, before anything is awaited.
  const { doc } = getState();
  const view = editorBridge.view;
  const inRoot = !!doc && paths.isInside(doc.path, root);
  const document = opts.includeDoc && view && doc?.kind === 'markdown' ? { name: doc.name, text: view.state.doc.toString(), ...(inRoot ? { path: paths.relative(root, doc.path) } : {}) } : null;
  const projectFiles = opts.includeProject && doc?.projectPath === root ? { projectPath: root, ...(document ? { exclude: doc.path } : {}) } : undefined;
  const sel = view?.state.selection.main;
  const selection = view && sel && !sel.empty ? view.state.sliceDoc(sel.from, sel.to) : '';
  const references = aiReferences();
  const history: ChatTurn[] = [...chat.turns, { role: 'user', content: text, time: new Date().toISOString(), ...(doc ? { doc: doc.name } : {}) }];
  update(root, { turns: [...history, { role: 'assistant', content: '' }], busy: true });
  save(root, history);
  await refreshActiveGuides().catch(() => undefined);
  const request = { purpose: 'chat' as const, system: chatSystemPrompt(writingContext(), document, selection, true), messages: chatMessagesForRequest(history), references, projectFiles };
  const stream = streamAi(request, (soFar) =>
    update(root, { turns: [...history, { role: 'assistant', content: soFar }] }),
  );
  streams.set(root, stream);
  let reply: ChatTurn;
  try {
    const r = await stream.result;
    reply = r.refused ? { role: 'assistant', content: 'The model declined this request.', error: true } : { role: 'assistant', content: r.text, model: r.model };
  } catch (e) {
    reply = { role: 'assistant', content: e instanceof Error ? e.message : String(e), error: true };
  } finally {
    streams.delete(root);
  }
  const turns = [...history, { ...reply, time: new Date().toISOString() }];
  update(root, { turns, busy: false });
  save(root, turns);
}

export function stopChat(root: string): void {
  streams.get(root)?.cancel();
}

export async function clearChat(root: ChatRoot): Promise<void> {
  const ok = await api.ui.confirm(`Clear the chat for “${root.name}”?`, 'The conversation is deleted; it cannot be restored.', 'Clear Chat');
  if (!ok) return;
  update(root.path, { turns: [] });
  save(root.path, []);
}

/** Reloads conversations whose files changed on disk (another Mac, through a sync service). */
export function chatFilesChanged(changed: string[]): void {
  for (const [root, chat] of Object.entries(getState().chats)) {
    if (!chat.loaded || chat.busy || !changed.includes(paths.join(root, META_DIR, CHAT_FILE))) continue;
    api.chats
      .load(root)
      .then((turns) => {
        const now = getState().chats[root];
        if (now && !now.busy && JSON.stringify(now.turns) !== JSON.stringify(turns)) update(root, { turns });
      })
      .catch(() => undefined);
  }
}
