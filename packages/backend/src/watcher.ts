import { watch, type FSWatcher } from 'node:fs';
import { join, sep } from 'node:path';
import { HISTORY_FILE, META_DIR } from '@mde/core';

export interface WatchCallbacks {
  /** Files created, changed, or removed (absolute paths, debounced). */
  changed(paths: string[]): void;
}

/** Recursive watcher on the library folder (native FSEvents on macOS). */
export class LibraryWatcher {
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly cb: WatchCallbacks, private readonly delayMs = 300) {}

  start(root: string): void {
    this.stop();
    try {
      this.watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (name.endsWith(`${META_DIR}${sep}${HISTORY_FILE}`) || name.endsWith('.tmp') || name.endsWith('.DS_Store') || name.endsWith('.partial')) return;
        this.pending.add(join(root, name));
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.delayMs);
      });
      this.watcher.on('error', () => this.stop());
    } catch {
      this.watcher = null;
    }
  }

  private flush(): void {
    const paths = [...this.pending];
    this.pending.clear();
    this.timer = null;
    if (paths.length) this.cb.changed(paths);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
