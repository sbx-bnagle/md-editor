// The transport the UI expects on window.mdeHost (packages/ui/src/api/host.ts, HostTransport).

import type { AppEvent } from '@mde/core';

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
