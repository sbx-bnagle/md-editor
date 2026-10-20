// Provider-neutral AI types and the prompts the app sends. Providers live in the
// backend; prompts live here so every host sends the same instructions.

export type AiProviderKind = 'anthropic' | 'openai-compatible';
export type Effort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiProviderConfig {
  id: string;
  kind: AiProviderKind;
  name: string;
  /** Empty for the provider's own endpoint. OpenAI-compatible: e.g. http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  /** Claude only: reasoning effort. 'default' leaves it to the model. */
  effort: Effort;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AiPurpose = 'inline' | 'chat' | 'review' | 'voice' | 'headline' | 'test';

export interface AiRequest {
  providerId?: string;
  purpose: AiPurpose;
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  /** JSON Schema for structured output (used by providers that support it). */
  jsonSchema?: Record<string, unknown>;
}

export interface AiResult {
  text: string;
  model: string;
  providerName: string;
  stopReason: string;
  /** The model declined the request; `text` is empty. */
  refused: boolean;
}

/** Recorded when AI text is accepted into a document (used to refine voice guides). */
export interface AiInsertion {
  docPath: string;
  time: number;
  model: string;
  mode: 'generate' | 'rewrite' | 'chat';
  prompt: string;
  text: string;
}

/** Authorship annotation key for text written by a model. */
export function aiAuthorKey(model: string): string {
  return `&${model}`;
}

export function humanAuthorKey(name: string): string {
  return `@${name.trim() || 'Writer'}`;
}

export interface WritingContext {
  voice?: { name: string; text: string };
  style?: { name: string; rules: string; notes: string };
  documentName?: string;
}

function guideSections(ctx: WritingContext): string {
  const parts: string[] = [];
  if (ctx.voice?.text.trim()) parts.push(`<voice_guide name="${ctx.voice.name}">\n${ctx.voice.text.trim()}\n</voice_guide>`);
  if (ctx.style && (ctx.style.rules || ctx.style.notes)) {
    parts.push(`<style_guide name="${ctx.style.name}">\n${[ctx.style.rules, ctx.style.notes].filter(Boolean).join('\n\n')}\n</style_guide>`);
  }
  return parts.join('\n\n');
}

export function writingSystemPrompt(ctx: WritingContext): string {
  const guides = guideSections(ctx);
  return [
    'You help a writer draft and edit documents in a markdown editor. The writer will review everything you produce before it is used.',
    'Write in markdown. Match the voice and style guides when they are provided; the voice guide describes how the writer sounds, the style guide sets mechanics such as punctuation, spelling, and numbers.',
    'Use curly quotes and apostrophes. Keep any {{variable}} placeholders and content block lines (a line that is only a file path) exactly as they are.',
    guides,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Inline command bar: generate at the cursor or rewrite the selection. */
export function inlineMessages(opts: {
  mode: 'generate' | 'rewrite';
  instruction: string;
  before: string;
  selection: string;
  after: string;
}): AiMessage[] {
  const before = opts.before.slice(-6000);
  const after = opts.after.slice(0, 2000);
  if (opts.mode === 'rewrite') {
    return [
      {
        role: 'user',
        content: `<text_before>\n${before}\n</text_before>\n<selection>\n${opts.selection}\n</selection>\n<text_after>\n${after}\n</text_after>\n\nRewrite the selection: ${opts.instruction}\n\nReply with only the replacement text for the selection, ready to paste in place: no preamble, no quotation marks around it, no code fences.`,
      },
    ];
  }
  return [
    {
      role: 'user',
      content: `<text_before>\n${before}\n</text_before>\n<text_after>\n${after}\n</text_after>\n\nWrite text to insert at the cursor, which sits between text_before and text_after: ${opts.instruction}\n\nReply with only the text to insert, so it reads naturally with what comes before and after: no preamble, no code fences.`,
    },
  ];
}

export function chatSystemPrompt(ctx: WritingContext, document: { name: string; text: string } | null, selection: string): string {
  const parts = [writingSystemPrompt(ctx)];
  parts.push('When you propose text for the document, put it in a fenced block marked ```insert so the writer can insert it with one click. Keep discussion short.');
  if (document) parts.push(`<document name="${document.name}">\n${document.text}\n</document>`);
  if (selection.trim()) parts.push(`<selection>\n${selection}\n</selection>`);
  return parts.join('\n\n');
}

/** Text inside ```insert fences in a chat reply. */
export function insertBlocks(reply: string): string[] {
  const out: string[] = [];
  const re = /```insert[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply))) out.push(m[1].replace(/\n$/, ''));
  return out;
}

export interface ReviewIssue {
  quote: string;
  message: string;
  suggestion: string;
}

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: 'Exact text from the document, copied character for character, a few words long.' },
          message: { type: 'string', description: 'What breaks the guide and why, in one sentence.' },
          suggestion: { type: 'string', description: 'Replacement for the quoted text, or an empty string.' },
        },
        required: ['quote', 'message', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
} as const;

export function reviewMessages(ctx: WritingContext, document: string): AiMessage[] {
  return [
    {
      role: 'user',
      content: `${guideSections(ctx) || 'No guides are selected; review for clarity and consistency.'}\n\n<document>\n${document}\n</document>\n\nReview the document against the guides. Report places that break them and need judgement: tone, voice, structure, claims without support, unclear sentences. Mechanical points (punctuation, spelling, number style) are already checked separately, so skip them. Quote the exact text for each issue so it can be located. Respond with JSON matching {"issues":[{"quote":"…","message":"…","suggestion":"…"}]}; use an empty list when nothing needs attention.`,
    },
  ];
}

/** Finds the first JSON object in a model reply. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseReview(text: string): ReviewIssue[] {
  const data = extractJson(text) as { issues?: unknown } | null;
  if (!data || !Array.isArray(data.issues)) return [];
  return data.issues
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => ({ quote: String(i.quote ?? ''), message: String(i.message ?? ''), suggestion: String(i.suggestion ?? '') }))
    .filter((i) => i.quote && i.message);
}

/** Positions of quoted text in the document, in order; quotes that cannot be found are dropped. */
export function locateQuotes<T extends { quote: string }>(document: string, items: T[]): Array<T & { from: number; to: number }> {
  const out: Array<T & { from: number; to: number }> = [];
  const norm = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const docNorm = norm(document);
  for (const item of items) {
    const q = norm(item.quote.trim());
    if (!q) continue;
    const at = docNorm.indexOf(q);
    if (at !== -1) out.push({ ...item, from: at, to: at + q.length });
  }
  return out;
}

export function refineVoiceMessages(voice: { name: string; text: string }, examples: Array<{ ai: string; final: string }>): AiMessage[] {
  const pairs = examples
    .map((e, i) => `<example index="${i + 1}">\n<ai_draft>\n${e.ai}\n</ai_draft>\n<writer_version>\n${e.final}\n</writer_version>\n</example>`)
    .join('\n');
  return [
    {
      role: 'user',
      content: `<voice_guide name="${voice.name}">\n${voice.text}\n</voice_guide>\n\n${pairs}\n\nEach example pairs text an AI drafted with the passage as it now reads in the writer’s document. Where the writer changed the draft, the changes show how their voice differs from the AI’s. Revise the voice guide so future drafts need fewer of those changes: add or sharpen guidance the edits support, keep everything that still holds, and do not add rules the examples do not support. Reply with the complete revised guide in markdown and nothing else.`,
    },
  ];
}

export const HEADLINE_SCHEMA = {
  type: 'object',
  properties: {
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, why: { type: 'string' } },
        required: ['text', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['alternatives'],
  additionalProperties: false,
} as const;

export function headlineMessages(headline: string, context: string): AiMessage[] {
  return [
    {
      role: 'user',
      content: `<section>\n${context.slice(0, 4000)}\n</section>\n\nHeadline: ${headline}\n\nSuggest 5 alternative headlines for this section that are clearer and more engaging while staying accurate to the content and true to the voice guide. Respond with JSON matching {"alternatives":[{"text":"…","why":"…"}]}, with “why” in under 15 words.`,
    },
  ];
}

export function parseHeadlines(text: string): Array<{ text: string; why: string }> {
  const data = extractJson(text) as { alternatives?: unknown } | null;
  if (!data || !Array.isArray(data.alternatives)) return [];
  return data.alternatives
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).text === 'string')
    .map((a) => ({ text: String(a.text), why: String(a.why ?? '') }));
}
