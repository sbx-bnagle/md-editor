// What the library mount needs from a cloud storage service (Dropbox, Google Drive). Paths are
// relative to the library folder, '/'-separated, with names as the service stores them.

export interface RemoteEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtimeMs: number;
  /** Changes whenever the file's contents change (Dropbox rev, Drive version); '' for folders. */
  rev: string;
}

export interface UploadResult {
  entry: RemoteEntry;
  /** The file there was no longer the one this was edited from: the upload went to a copy (entry.path). */
  conflict?: boolean;
}

/** The service needs the user to sign in again. */
export class AuthError extends Error {}

/** The service could not be reached, or asked to wait (rate limit, server error): try again later. */
export class OfflineError extends Error {}

/** The change cursor is no longer valid: list everything again. */
export class CursorReset extends Error {}

export interface Provider {
  /** "Dropbox", "Google Drive". */
  readonly label: string;
  /** Everything in the library folder, and a cursor for later changes. */
  list(): Promise<{ entries: RemoteEntry[]; cursor: string }>;
  /** Changes since `cursor`: new or changed entries, and removed paths (entry null). */
  changes(cursor: string): Promise<{ changes: Array<{ path: string; entry: RemoteEntry | null }>; cursor: string }>;
  download(path: string): Promise<Uint8Array>;
  /**
   * Writes a file. `base` is the rev it was edited from (null for a new file): when the file there
   * has another rev, the upload is saved as a copy beside it and `conflict` is set.
   */
  upload(path: string, data: Uint8Array, base: string | null): Promise<UploadResult>;
  /** Creates a folder; one that exists already is fine. */
  mkdir(path: string): Promise<void>;
  /** Moves or renames; nothing may be at `to`. */
  move(from: string, to: string): Promise<void>;
  /** Moves to the service's trash or deleted files (they can be restored there); a missing path is fine. */
  remove(path: string): Promise<void>;
  /** The user's AI keys, kept with their account (outside the library). */
  readSecrets(): Promise<string | null>;
  writeSecrets(text: string): Promise<void>;
  /** A web address showing the item on the service's own site. */
  webUrl(path: string): string | null;
  /** What the provider keeps about the folder (Drive: ids by path), saved with the tree. */
  saveState?(): unknown;
  restoreState?(state: unknown): void;
}
