import type { AiAttachment, AiProviderConfig, AiRequest, AiResult } from '@mde/core';

export interface StreamOptions {
  apiKey: string | null;
  onText: (delta: string) => void;
  signal: AbortSignal;
  /** Reference files to put before the first user message. */
  attachments?: AiAttachment[];
}

/** One AI service family. Implementations translate AiRequest to the service's API. */
export interface ProviderDriver {
  stream(config: AiProviderConfig, req: AiRequest, opts: StreamOptions): Promise<AiResult>;
  listModels(config: AiProviderConfig, apiKey: string | null): Promise<string[]>;
}

export class AiError extends Error {
  readonly userFacing = true;
}
