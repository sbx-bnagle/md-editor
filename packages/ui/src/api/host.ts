// Builds the typed AppApi on top of whatever transport the host injects.
// Electron's preload exposes `window.mdeHost`; another host only has to provide the
// same small transport (invoke + subscribe + spell) to reuse the whole UI.

import type { AppApi, AppEvent } from '@mde/core';

export interface HostTransport {
  invoke(method: string, args: unknown[]): Promise<{ ok: boolean; value?: unknown; message?: string; userFacing?: boolean }>;
  subscribe(listener: (event: AppEvent) => void): () => void;
  spell?: {
    check(words: string[]): string[] | Promise<string[]>;
    suggest(word: string): string[] | Promise<string[]>;
  };
  platform?: string;
}

declare global {
  interface Window {
    mdeHost?: HostTransport;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly userFacing: boolean,
  ) {
    super(message);
  }
}

export function createApi(transport: HostTransport): AppApi {
  const call = async (method: string, args: unknown[]) => {
    const r = await transport.invoke(method, args);
    if (!r.ok) throw new ApiError(r.message ?? 'Unknown error', !!r.userFacing);
    return r.value;
  };
  const overrides: Partial<Record<keyof AppApi, unknown>> = {
    spell: {
      check: async (words: string[]) => transport.spell?.check(words) ?? [],
      suggest: async (word: string) => transport.spell?.suggest(word) ?? [],
      learn: (word: string) => call('spell.learn', [word]),
      available: async () => !!transport.spell,
    },
    events: {
      subscribe: (listener: (e: AppEvent) => void) => transport.subscribe(listener),
    },
  };
  return new Proxy({} as AppApi, {
    get(_t, ns: string) {
      if (ns in overrides) return overrides[ns as keyof AppApi];
      return new Proxy(
        {},
        {
          get: (_t2, method: string) =>
            (...args: unknown[]) =>
              call(`${ns}.${method}`, args),
        },
      );
    },
  });
}

export const api: AppApi = createApi(
  window.mdeHost ?? {
    invoke: async () => ({ ok: false, message: 'No host available. Run the UI inside the desktop app.' }),
    subscribe: () => () => undefined,
  },
);

export const isMac = (window.mdeHost?.platform ?? 'darwin') === 'darwin';
/** The iPad app (apps/ipad): no Finder tags, and files are shown in the Files app. */
export const isIpad = window.mdeHost?.platform === 'ios';
/** The app that shows the user's files, as named in menus and messages. */
export const FILES_APP = isIpad ? 'Files' : 'Finder';
