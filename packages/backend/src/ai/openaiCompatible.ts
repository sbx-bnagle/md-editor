// OpenAI-compatible chat completions (OpenAI, OpenRouter, Ollama, LM Studio, and others).

import type { AiAttachment, AiProviderConfig, AiRequest, AiResult } from '@mde/core';
import { AiError, type ProviderDriver, type StreamOptions } from './types';

function endpoint(config: AiProviderConfig, path: string): string {
  if (!config.baseUrl) throw new AiError(`Set the server address for ${config.name} in Settings.`);
  return `${config.baseUrl.replace(/\/+$/, '')}${path}`;
}

function headers(apiKey: string | null): Record<string, string> {
  return { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
}

async function failure(res: Response, config: AiProviderConfig): Promise<AiError> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
  } catch {
    // no JSON body
  }
  if (res.status === 401 || res.status === 403) return new AiError(`${config.name} rejected the API key.${detail ? ` ${detail}` : ''}`);
  if (res.status === 404) return new AiError(`${config.name}: not found (check the address and model).${detail ? ` ${detail}` : ''}`);
  if (res.status === 429) return new AiError(`${config.name} is rate limiting requests.${detail ? ` ${detail}` : ''}`);
  return new AiError(`${config.name} error ${res.status}.${detail ? ` ${detail}` : ''}`);
}

type ChatContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

/** References as text before the first user message; images as image parts (vision models only). */
function withAttachments(messages: AiRequest['messages'], attachments: AiAttachment[] | undefined): Array<{ role: string; content: ChatContent }> {
  const out: Array<{ role: string; content: ChatContent }> = messages.map((m) => ({ role: m.role, content: m.content }));
  if (!attachments?.length || out[0]?.role !== 'user') return out;
  const text = attachments
    .filter((a) => a.kind !== 'image' && a.text)
    .map((a) => `<reference name="${a.name}">\n${a.text}\n</reference>`)
    .join('\n\n');
  const images = attachments.filter((a) => a.kind === 'image' && a.data);
  const first = messages[0].content;
  if (!images.length) out[0] = { role: 'user', content: text ? `${text}\n\n${first}` : first };
  else
    out[0] = {
      role: 'user',
      content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...images.flatMap((a) => [
          { type: 'text' as const, text: `Reference image: ${a.name}` },
          { type: 'image_url' as const, image_url: { url: `data:${a.mediaType};base64,${a.data}` } },
        ]),
        { type: 'text' as const, text: first },
      ],
    };
  return out;
}

export const openAiCompatibleDriver: ProviderDriver = {
  async stream(config: AiProviderConfig, req: AiRequest, opts: StreamOptions): Promise<AiResult> {
    if (!config.model) throw new AiError(`Choose a model for ${config.name} in Settings.`);
    let res: Response;
    try {
      res = await fetch(endpoint(config, '/chat/completions'), {
        method: 'POST',
        headers: headers(opts.apiKey),
        signal: opts.signal,
        body: JSON.stringify({
          model: config.model,
          stream: true,
          max_tokens: req.maxTokens ?? 8192,
          messages: [{ role: 'system', content: req.system }, ...withAttachments(req.messages, opts.attachments)],
        }),
      });
    } catch (e) {
      if (opts.signal.aborted) throw new AiError('Cancelled.');
      throw new AiError(`Could not reach ${config.name} at ${config.baseUrl}.`);
    }
    if (!res.ok || !res.body) throw await failure(res, config);

    let text = '';
    let stopReason = 'end_turn';
    let model = config.model;
    const decoder = new TextDecoder();
    let buffer = '';
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data) as { model?: string; choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> };
            if (chunk.model) model = chunk.model;
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content;
            if (delta) {
              text += delta;
              opts.onText(delta);
            }
            if (choice?.finish_reason) stopReason = choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason;
          } catch {
            // ignore keep-alive or malformed lines
          }
        }
      }
    } catch (e) {
      if (opts.signal.aborted) throw new AiError('Cancelled.');
      throw e;
    }
    return { text, model, providerName: config.name, stopReason, refused: stopReason === 'content_filter' };
  },

  async listModels(config: AiProviderConfig, apiKey: string | null): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(endpoint(config, '/models'), { headers: headers(apiKey) });
    } catch {
      throw new AiError(`Could not reach ${config.name} at ${config.baseUrl}.`);
    }
    if (!res.ok) throw await failure(res, config);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id).sort();
  },
};
