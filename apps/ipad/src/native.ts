// The bridge to the Swift shell ("Folio Dome.swiftpm/Sources/Bridge.swift").
//
// Requests go through a WKScriptMessageHandlerWithReply named "folio": each is { op, ...args }
// and the reply is { ok: true, value } or { ok: false, code, message }. The shell sends events
// by calling window.__folioDispatch({ type, ... }).
//
// Binary data crosses the bridge as base64.

export interface NativeError extends Error {
  code?: string;
}

interface Reply {
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}

interface FolioWindow {
  webkit?: { messageHandlers?: { folio?: { postMessage(message: unknown): Promise<Reply> } } };
  __folioDispatch?: (event: NativeEvent) => void;
}

export type NativeEvent =
  | { type: 'fs.change'; id: string; paths: string[] }
  | { type: 'http.head'; id: string; status: number; headers: Record<string, string> }
  | { type: 'http.data'; id: string; data: string }
  | { type: 'http.end'; id: string; error?: string }
  | { type: 'menu'; command: string }
  | { type: 'app.active'; active: boolean }
  | { type: 'contextmenu'; x: number; y: number };

const w = window as unknown as FolioWindow;

export function hasNative(): boolean {
  return !!w.webkit?.messageHandlers?.folio;
}

export async function native<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const handler = w.webkit?.messageHandlers?.folio;
  if (!handler) throw new Error('Folio Dome’s iPad shell is not available.');
  const reply = await handler.postMessage({ op, ...args });
  if (reply?.ok) return reply.value as T;
  throw nativeError(reply?.code, reply?.message ?? `${op} failed`);
}

export function nativeError(code: string | undefined, message: string): NativeError {
  // Node's form ("ENOENT: no such file or directory, open '…'"): the backend and the UI look for the code in messages.
  const e: NativeError = new Error(code && !message.startsWith(code) ? `${code}: ${message}` : message);
  if (code) e.code = code;
  return e;
}

const listeners = new Set<(e: NativeEvent) => void>();

export function onNative(listener: (e: NativeEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

w.__folioDispatch = (event) => {
  for (const l of listeners) {
    try {
      l(event);
    } catch (e) {
      console.error('Native event handler failed', e);
    }
  }
};

export { fromBase64, toBase64 } from './base64';
