import type { AppEvent } from '@mde/core';

/** Capabilities the backend needs from the hosting shell (Electron today). */
export interface HostAdapter {
  /** Moves a file or folder to the Trash. */
  trash(path: string): Promise<void>;
  reveal(path: string): void;
  /** Lays out and prints a document to PDF bytes. */
  /** Lays out and prints to a tagged PDF (the backend then adds what PDF/UA needs; see pdfAccessibility.ts). */
  renderPdf(input: { html: string; css: string; title: string; lang: string }): Promise<Uint8Array>;
  chooseSavePath(opts: { title: string; defaultPath: string; extensions: string[] }): Promise<string | null>;
  chooseFolder(title: string): Promise<string | null>;
  emit(event: AppEvent): void;
  /** Encrypted storage for API keys (macOS Keychain-backed in the Electron host). */
  secrets: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string | null): Promise<void>;
  };
}
