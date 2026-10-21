import { promises as fs } from 'node:fs';
import { Thesaurus, type ThesaurusOptions, type ThesaurusResult } from '@mde/core';

/** Loads the thesaurus data file on first use (about 0.4 s) and answers lookups. */
export class ThesaurusService {
  private loading: Promise<Thesaurus | null> | null = null;
  private readonly dataPath: string | undefined;

  constructor(dataPath: string | undefined) {
    this.dataPath = dataPath;
  }

  private load(): Promise<Thesaurus | null> {
    this.loading ??= (async () => {
      if (!this.dataPath) return null;
      try {
        return Thesaurus.decode(await fs.readFile(this.dataPath));
      } catch (e) {
        console.error(`Thesaurus not available (${this.dataPath}):`, e);
        return null;
      }
    })();
    return this.loading;
  }

  /** Loads the data after `delayMs` so the first lookup is fast without slowing startup. */
  warm(delayMs: number): void {
    setTimeout(() => void this.load(), delayMs).unref?.();
  }

  async lookup(word: string, options?: ThesaurusOptions): Promise<ThesaurusResult | null> {
    const t = await this.load();
    return t ? t.lookup(word, options) : null;
  }
}
