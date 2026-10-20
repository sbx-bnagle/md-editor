// Claude, through the official Anthropic SDK.

import Anthropic from '@anthropic-ai/sdk';
import type { AiProviderConfig, AiRequest, AiResult } from '@mde/core';
import { AiError, type ProviderDriver, type StreamOptions } from './types';

/** Models that accept server-side refusal fallback in its "default" form on the Claude API. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

function client(config: AiProviderConfig, apiKey: string | null): Anthropic {
  if (!apiKey) throw new AiError(`Add an API key for ${config.name} in Settings.`);
  return new Anthropic({ apiKey, baseURL: config.baseUrl || undefined, maxRetries: 2 });
}

function explain(e: unknown, config: AiProviderConfig): Error {
  if (e instanceof Anthropic.AuthenticationError) return new AiError(`${config.name} rejected the API key.`);
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError(`${config.name}: this key cannot use ${config.model}.`);
  if (e instanceof Anthropic.NotFoundError) return new AiError(`${config.name}: model “${config.model}” was not found.`);
  if (e instanceof Anthropic.RateLimitError) return new AiError(`${config.name} is rate limiting requests. Try again shortly.`);
  if (e instanceof Anthropic.BadRequestError) return new AiError(`${config.name} rejected the request: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new AiError(`Could not reach ${config.name}. Check the network connection.`);
  if (e instanceof Anthropic.APIError) return new AiError(`${config.name} error ${e.status ?? ''}: ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

export const anthropicDriver: ProviderDriver = {
  async stream(config: AiProviderConfig, req: AiRequest, opts: StreamOptions): Promise<AiResult> {
    const c = client(config, opts.apiKey);
    const firstParty = !config.baseUrl;
    try {
      const stream = c.beta.messages.stream(
        {
          model: config.model,
          max_tokens: req.maxTokens ?? 64000,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: req.messages,
          ...(config.effort !== 'default' || req.jsonSchema
            ? {
                output_config: {
                  ...(config.effort !== 'default' ? { effort: config.effort } : {}),
                  ...(req.jsonSchema ? { format: { type: 'json_schema' as const, schema: req.jsonSchema } } : {}),
                },
              }
            : {}),
          // If a safety classifier declines, the API retries on a recommended model.
          ...(firstParty && FALLBACK_MODELS.has(config.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: opts.signal },
      );
      stream.on('text', (delta) => opts.onText(delta));
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        return { text: '', model: message.model, providerName: config.name, stopReason: 'refusal', refused: true };
      }
      // After a fallback, only text from the model that finished the turn is used.
      const blocks = message.content;
      const lastFallback = blocks.map((b) => b.type).lastIndexOf('fallback' as never);
      const text = blocks
        .slice(lastFallback + 1)
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { text, model: message.model, providerName: config.name, stopReason: message.stop_reason ?? 'end_turn', refused: false };
    } catch (e) {
      if (opts.signal.aborted) throw new AiError('Cancelled.');
      throw explain(e, config);
    }
  },

  async listModels(config: AiProviderConfig, apiKey: string | null): Promise<string[]> {
    const c = client(config, apiKey);
    try {
      const ids: string[] = [];
      for await (const m of c.models.list()) ids.push(m.id);
      return ids;
    } catch (e) {
      throw explain(e, config);
    }
  },
};
