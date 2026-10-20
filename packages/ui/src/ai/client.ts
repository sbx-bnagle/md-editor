// Turns the event-based AI stream (ai-delta / ai-done / ai-error) into a promise with a
// progress callback. Events that arrive before start() returns are buffered.

import type { AiRequest, AiResult, AppEvent } from '@mde/core';
import { api } from '../api/host';

type AiEvent = Extract<AppEvent, { type: 'ai-delta' | 'ai-done' | 'ai-error' }>;

const buffered = new Map<string, AiEvent[]>();
const handlers = new Map<string, (e: AiEvent) => void>();
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  api.events.subscribe((e) => {
    if (e.type !== 'ai-delta' && e.type !== 'ai-done' && e.type !== 'ai-error') return;
    const h = handlers.get(e.id);
    if (h) h(e);
    else buffered.set(e.id, [...(buffered.get(e.id) ?? []), e]);
  });
}

export interface AiStream {
  result: Promise<AiResult>;
  cancel(): void;
}

export function streamAi(req: AiRequest, onText: (textSoFar: string) => void): AiStream {
  ensureSubscribed();
  let id: string | null = null;
  let cancelled = false;
  let text = '';
  const result = new Promise<AiResult>((resolve, reject) => {
    const handle = (e: AiEvent) => {
      if (e.type === 'ai-delta') {
        text += e.text;
        onText(text);
      } else {
        handlers.delete(e.id);
        if (e.type === 'ai-done') resolve(e.result);
        else reject(new Error(e.message));
      }
    };
    api.ai
      .start(req)
      .then((r) => {
        id = r.id;
        if (cancelled) {
          api.ai.cancel(r.id);
          reject(new Error('Cancelled.'));
          return;
        }
        handlers.set(r.id, handle);
        for (const e of buffered.get(r.id) ?? []) handle(e);
        buffered.delete(r.id);
      })
      .catch(reject);
  });
  return {
    result,
    cancel() {
      cancelled = true;
      if (id) api.ai.cancel(id);
    },
  };
}
