// fetch() for the AI services, sent by the Swift shell (HttpProxy.swift).
//
// API keys stay in the Keychain: the backend is given a stand-in for each key (keyToken) and
// the shell puts the key in its place in the request headers. The shell also avoids the web
// view's cross-origin rules, which most AI servers do not allow for, and streams the reply back
// in pieces, which the Anthropic SDK and the OpenAI-compatible driver read as they arrive.

import { fromBase64, native, onNative, toBase64 } from './native';

/** The stand-in the backend uses as the key named `name` ("ai-key:…"); see Keychain.swift. */
export function keyToken(name: string): string {
  return `folio-keychain-${name.replace(/[^A-Za-z0-9._-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
}

interface Pending {
  head(status: number, headers: Record<string, string>): void;
  data(bytes: Uint8Array): void;
  end(error?: string): void;
}

const pending = new Map<string, Pending>();
let ids = 0;

onNative((e) => {
  if (e.type !== 'http.head' && e.type !== 'http.data' && e.type !== 'http.end') return;
  const p = pending.get(e.id);
  if (!p) return;
  if (e.type === 'http.head') p.head(e.status, e.headers);
  else if (e.type === 'http.data') p.data(fromBase64(e.data));
  else {
    pending.delete(e.id);
    p.end(e.error);
  }
});

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (body === null || body === undefined) return null;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export const nativeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const signal = init?.signal ?? request.signal;
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  const id = `h${++ids}`;
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => (headers[k] = v));
  const body = init?.body !== undefined ? await bodyBytes(init.body) : request.body ? new Uint8Array(await request.arrayBuffer()) : null;

  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let settled = false;
    const queued: Uint8Array[] = [];
    let ended: { error?: string } | null = null;
    const abortError = () => signal?.reason ?? new DOMException('Aborted', 'AbortError');

    const finish = () => {
      if (!controller || !ended) return;
      if (ended.error) controller.error(new TypeError(ended.error));
      else controller.close();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        for (const q of queued) c.enqueue(q);
        queued.length = 0;
        finish();
      },
      cancel() {
        pending.delete(id);
        native('http.cancel', { id }).catch(() => undefined);
      },
    });
    const onAbort = () => {
      pending.delete(id);
      native('http.cancel', { id }).catch(() => undefined);
      const err = abortError();
      if (!settled) {
        settled = true;
        reject(err);
      } else {
        try {
          controller?.error(err);
        } catch {
          // already closed
        }
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    pending.set(id, {
      head(status, h) {
        if (settled) return;
        settled = true;
        // Responses with no body (204, 304) may not carry a stream.
        const noBody = status === 204 || status === 304 || request.method === 'HEAD';
        resolve(new Response(noBody ? null : stream, { status, headers: h }));
      },
      data(bytes) {
        if (controller) controller.enqueue(bytes);
        else queued.push(bytes);
      },
      end(error) {
        signal?.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          reject(new TypeError(error ?? 'The request failed.'));
          return;
        }
        ended = { error };
        finish();
      },
    });

    native('http.start', { id, url: request.url, method: request.method, headers, body: body ? toBase64(body) : null }).catch((e) => {
      pending.delete(id);
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
};
