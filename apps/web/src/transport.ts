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
  /** The service holding the library ("Dropbox", "Google Drive"), named where the Mac app says Finder. */
  filesApp?: string;
  /** Where asset URLs point (the service worker's address). */
  assetPrefix?: string;
  /** Paths of dropped files: copied into this browser's storage first (dropped files have no path here). */
  pathsForFiles?(files: File[]): Promise<string[]>;
}

declare global {
  interface Window {
    mdeHost?: HostTransport;
  }
}
