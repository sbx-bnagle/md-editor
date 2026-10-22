// Runs AI requests for the UI: picks the provider, reads its key from secure storage,
// streams text back as events, and supports cancellation.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AI_LOG_FILE, META_DIR, projectFilesSystemNote, referencesSystemNote, type AiAttachment, type AiInsertion, type AiProviderConfig, type AiRequest, type AiResult, type Preferences } from '@mde/core';
import type { HostAdapter } from '../host';
import type { LibraryService } from '../library';
import type { ReferenceService } from '../references';
import type { DocumentService } from '../documents';
import { projectFileAttachments } from './projectFiles';
import { anthropicDriver } from './anthropic';
import { openAiCompatibleDriver } from './openaiCompatible';
import { AiError, type ProviderDriver } from './types';

const drivers: Record<AiProviderConfig['kind'], ProviderDriver> = {
  anthropic: anthropicDriver,
  'openai-compatible': openAiCompatibleDriver,
};

const keyName = (providerId: string) => `ai-key:${providerId}`;

export class AiService {
  private running = new Map<string, AbortController>();

  constructor(
    private readonly host: HostAdapter,
    private readonly library: LibraryService,
    private readonly prefs: () => Preferences,
    private readonly references?: ReferenceService,
    private readonly documents?: DocumentService,
  ) {}

  private provider(id?: string): AiProviderConfig {
    const p = this.prefs().ai;
    const config = p.providers.find((x) => x.id === (id ?? p.defaultProvider)) ?? p.providers[0];
    if (!config) throw new AiError('No AI service is set up. Add one in Settings.');
    return config;
  }

  async keyStatus(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const p of this.prefs().ai.providers) out[p.id] = !!(await this.host.secrets.get(keyName(p.id)));
    return out;
  }

  async setKey(providerId: string, key: string | null): Promise<void> {
    await this.host.secrets.set(keyName(providerId), key && key.trim() ? key.trim() : null);
  }

  async listModels(providerId: string): Promise<string[]> {
    const config = this.provider(providerId);
    return drivers[config.kind].listModels(config, await this.host.secrets.get(keyName(config.id)));
  }

  private async run(req: AiRequest, onText: (t: string) => void, signal: AbortSignal): Promise<AiResult> {
    const config = this.provider(req.providerId);
    const apiKey = await this.host.secrets.get(keyName(config.id));
    let attachments: AiAttachment[] = [];
    let system = req.system;
    if (req.projectFiles && this.documents) {
      const files = await projectFileAttachments(this.library, this.documents, this.library.assertInside(req.projectFiles.projectPath), req.projectFiles.exclude);
      attachments.push(...files.attachments);
      const note = projectFilesSystemNote(files.included, files.omitted);
      if (note) system = `${system}\n\n${note}`;
    }
    if (req.references && this.references) {
      const refs = await this.references.attachments(req.references.projectPath);
      attachments.push(...refs);
      if (refs.length) system = `${system}\n\n${referencesSystemNote(refs.map((a) => a.name))}`;
    }
    return drivers[config.kind].stream(config, { ...req, system }, { apiKey, onText, signal, attachments });
  }

  async test(providerId: string): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.complete({ providerId, purpose: 'test', system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'Say OK.' }], maxTokens: 64 });
      return r.refused ? { ok: false, message: 'The model declined the test request.' } : { ok: true, message: `Connected: ${r.model} replied “${r.text.trim().slice(0, 40)}”.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** A reply in one piece (review, headlines, voice, the connection test), given up after a time limit. */
  async complete(req: AiRequest): Promise<AiResult> {
    return this.run(req, () => undefined, AbortSignal.timeout(req.purpose === 'test' ? 30_000 : 300_000));
  }

  async start(req: AiRequest): Promise<{ id: string }> {
    const id = randomBytes(8).toString('hex');
    const controller = new AbortController();
    this.running.set(id, controller);
    // Coalesce small deltas so the UI is not flooded with events.
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (pending) this.host.emit({ type: 'ai-delta', id, text: pending });
      pending = '';
    };
    this.run(
      req,
      (t) => {
        pending += t;
        if (!timer) timer = setTimeout(flush, 30);
      },
      controller.signal,
    )
      .then((result) => {
        if (timer) clearTimeout(timer);
        flush();
        this.host.emit({ type: 'ai-done', id, result });
      })
      .catch((e: unknown) => {
        if (timer) clearTimeout(timer);
        this.host.emit({ type: 'ai-error', id, message: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => this.running.delete(id));
    return { id };
  }

  async cancel(id: string): Promise<void> {
    this.running.get(id)?.abort();
    this.running.delete(id);
  }

  cancelAll(): void {
    for (const c of this.running.values()) c.abort();
    this.running.clear();
  }

  async logInsertion(entry: AiInsertion): Promise<void> {
    this.library.assertInside(entry.docPath);
    const project = this.library.projectFor(entry.docPath);
    if (!project) return;
    const file = join(project, META_DIR, AI_LOG_FILE);
    await fs.mkdir(join(project, META_DIR), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`);
  }

  async insertions(projectPath: string, limit = 20): Promise<AiInsertion[]> {
    this.library.assertInside(projectPath);
    try {
      const lines = (await fs.readFile(join(projectPath, META_DIR, AI_LOG_FILE), 'utf8')).split('\n').filter(Boolean);
      return lines
        .slice(-limit)
        .map((l) => {
          try {
            return JSON.parse(l) as AiInsertion;
          } catch {
            return null;
          }
        })
        .filter((x): x is AiInsertion => !!x);
    } catch {
      return [];
    }
  }
}
