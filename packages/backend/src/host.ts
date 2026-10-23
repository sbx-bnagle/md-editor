import type { AppEvent } from '@mde/core';

export interface PrintedPdf {
  pdf: Uint8Array;
  /** Placeholder pages for inserted PDF pages: 0-based page index, project-relative file, 1-based page. */
  inserts: Array<{ index: number; file: string; page: number; alt: string }>;
}

/** Capabilities the backend needs from the hosting shell (Electron today). */
export interface HostAdapter {
  /** Moves a file or folder to the Trash. */
  trash(path: string): Promise<void>;
  reveal(path: string): void;
  /** Lays out and prints to a tagged PDF (the backend then adds what PDF/UA needs; see pdfAccessibility.ts). */
  renderPdf(input: { html: string; css: string; title: string; lang: string }): Promise<PrintedPdf>;
  chooseSavePath(opts: { title: string; defaultPath: string; extensions: string[] }): Promise<string | null>;
  chooseFolder(title: string): Promise<string | null>;
  chooseFiles(title: string, extensions?: string[]): Promise<string[]>;
  /** Draws diagrams and inserted PDF pages into document HTML for the web export (no pages). */
  renderWebPage(input: { html: string; css: string; title: string; lang: string }): Promise<string>;
  /** An extended attribute's value (Finder tags), or null when the file has none by that name. */
  readXattr(path: string, name: string): Promise<Uint8Array | null>;
  /** Sets an extended attribute, or removes it when `value` is null. */
  writeXattr(path: string, name: string, value: Uint8Array | null): Promise<void>;
  emit(event: AppEvent): void;
  /**
   * HTTP for the AI services, when the host sends requests itself (the iPad host: its secrets.get
   * returns a stand-in that it swaps for the key natively, so keys never enter the web view).
   * Without it, the global fetch is used.
   */
  fetch?: typeof fetch;
  /** Encrypted storage for API keys (macOS Keychain-backed in the Electron host). */
  secrets: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string | null): Promise<void>;
  };
}
