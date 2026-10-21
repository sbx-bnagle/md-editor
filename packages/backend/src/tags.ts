// Finder tags as coloured dots in the library. Tags live on the files themselves (an extended
// attribute read and written through the host), so Finder shows the same tags.

import { promises as fs } from 'node:fs';
import { FINDER_TAGS_ATTR, decodeFinderTags, encodeFinderTags, tagColors, withTagColor, type FinderTag, type TagColor } from '@mde/core';
import type { HostAdapter } from './host';
import type { LibraryService } from './library';

const PARALLEL = 8;

export class TagService {
  /** Tags by path, valid while the file's change time (ctime) is the same. */
  private cache = new Map<string, { ctimeMs: number; tags: FinderTag[] }>();

  constructor(
    private readonly library: LibraryService,
    private readonly host: HostAdapter,
  ) {}

  private async read(path: string): Promise<FinderTag[]> {
    const st = await fs.stat(path).catch(() => null);
    if (!st) return [];
    const hit = this.cache.get(path);
    if (hit && hit.ctimeMs === st.ctimeMs) return hit.tags;
    const tags = decodeFinderTags(await this.host.readXattr(path, FINDER_TAGS_ATTR).catch(() => null));
    this.cache.set(path, { ctimeMs: st.ctimeMs, tags });
    return tags;
  }

  /** Tag colours of each path that has any. */
  async colors(paths: string[]): Promise<Record<string, TagColor[]>> {
    const out: Record<string, TagColor[]> = {};
    const queue = paths.map((p) => this.library.assertInside(p));
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
        for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
          const colors = tagColors(await this.read(p));
          if (colors.length) out[p] = colors;
        }
      }),
    );
    return out;
  }

  /** Switches one colour on or off; returns the path's colours afterwards. */
  async set(path: string, color: TagColor, on: boolean): Promise<TagColor[]> {
    this.library.assertInside(path);
    this.cache.delete(path);
    const tags = withTagColor(await this.read(path), color, on);
    await this.host.writeXattr(path, FINDER_TAGS_ATTR, tags.length ? encodeFinderTags(tags) : null);
    this.cache.delete(path);
    return tagColors(tags);
  }
}
