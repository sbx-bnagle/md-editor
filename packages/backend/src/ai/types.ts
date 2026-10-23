import type { AiAttachment, AiProviderConfig, AiRequest, AiResult } from '@mde/core';

export interface StreamOptions {
  apiKey: string | null;
  onText: (delta: string) => void;
  signal: AbortSignal;
  /** Reference files to put before the first user message. */
  attachments?: AiAttachment[];
  /** The host's HTTP client (HostAdapter.fetch), when it has one. */
  fetch?: typeof fetch;
}

/** One AI service family. Implementations translate AiRequest to the service's API. */
export interface ProviderDriver {
  stream(config: AiProviderConfig, req: AiRequest, opts: StreamOptions): Promise<AiResult>;
  listModels(config: AiProviderConfig, apiKey: string | null, fetchImpl?: typeof fetch): Promise<string[]>;
}

export class AiError extends Error {
  readonly userFacing = true;
}

/** Whether a request was stopped by its time limit (AbortSignal.timeout) rather than by Stop. */
export function timedOut(signal: AbortSignal): boolean {
  return (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError';
}
