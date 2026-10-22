// Provider-neutral AI types and the prompts the app sends. Providers live in the
// backend; prompts live here so every host sends the same instructions.

import { EDIT_INSTRUCTIONS } from './aiEdits';

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

/** A turn of an Assistant conversation, as kept in a project's chat file. */
export interface ChatTurn extends AiMessage {
  model?: string;
  /** An error shown in place of a reply; never sent back to the model. */
  error?: boolean;
  /** File name of the document open when the message was sent. */
  doc?: string;
  /** ISO time the turn was added. */
  time?: string;
}

/** Characters of earlier conversation sent with a chat request; older turns stay in the chat but are not sent. */
export const CHAT_CONTEXT_CHARS = 60000;

/**
 * The most recent turns that fit in `budget` characters, starting with a user turn, without error
 * turns. The last turn (the new message) is always included.
 */
export function chatMessagesForRequest(turns: ChatTurn[], budget = CHAT_CONTEXT_CHARS): AiMessage[] {
  const usable = turns.filter((t) => !t.error && t.content);
  let start = usable.length;
  let size = 0;
  while (start > 0 && (start === usable.length || size + usable[start - 1].content.length <= budget)) {
    size += usable[start - 1].content.length;
    start--;
  }
  while (start < usable.length - 1 && usable[start].role !== 'user') start++;
  return usable.slice(start).map(({ role, content }) => ({ role, content }));
}

/** Turns read from a chat file, keeping only well-formed ones. */
export function parseChatTurns(value: unknown): ChatTurn[] {
  const turns = (value as { turns?: unknown })?.turns;
  if (!Array.isArray(turns)) return [];
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string') continue;
    const turn: ChatTurn = { role: t.role, content: t.content };
    if (typeof t.model === 'string') turn.model = t.model;
    if (t.error === true) turn.error = true;
    if (typeof t.doc === 'string') turn.doc = t.doc;
    if (typeof t.time === 'string') turn.time = t.time;
    out.push(turn);
  }
  return out;
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
  /** Attach the project's included reference files (see references.ts). */
  references?: { projectPath: string };
  /** Attach the project's markdown files (except `exclude`, the open document, which is sent in the prompt). */
  projectFiles?: { projectPath: string; exclude?: string };
}

/** Characters of project files attached to a chat request; files past this are listed by name only. */
export const PROJECT_FILES_CHARS = 200000;

export function projectFilesSystemNote(included: string[], omitted: string[]): string {
  const parts: string[] = [];
  if (included.length) parts.push(`The project's other markdown files are attached at the start of the conversation, titled by their path in the project: ${included.map((n) => `“${n}”`).join(', ')}.`);
  if (omitted.length) parts.push(`These project files were left out to keep the request small; ask the writer to open one if you need it: ${omitted.map((n) => `“${n}”`).join(', ')}.`);
  return parts.join(' ');
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

/**
 * The Assistant's system prompt. `document.path` is the open document's path in the project; with
 * `edits`, the Assistant may propose changes to project files (aiEdits.ts).
 */
export function chatSystemPrompt(ctx: WritingContext, document: { name: string; text: string; path?: string } | null, selection: string, edits = false): string {
  const parts = [writingSystemPrompt(ctx)];
  parts.push('When you propose new text for the writer to place at the cursor, put it in a fenced block marked ```insert so the writer can insert it with one click. Keep discussion short.');
  if (edits) parts.push(EDIT_INSTRUCTIONS);
  if (document) parts.push(`<document name="${document.name}"${document.path ? ` path="${document.path}"` : ''}>\n${document.text}\n</document>`);
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
    gaps: {
      type: 'array',
      description: 'Requirements or requests in the reference files that the document does not address. Empty without references.',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: 'The requirement, briefly, in the reference’s words where possible.' },
          source: { type: 'string', description: 'File name and page or section where it appears.' },
        },
        required: ['requirement', 'source'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues', 'gaps'],
  additionalProperties: false,
} as const;

export interface ReviewGap {
  requirement: string;
  source: string;
}

export function reviewMessages(ctx: WritingContext, document: string, withReferences = false): AiMessage[] {
  const references = withReferences
    ? ' Also check the document against the attached reference files: report statements that contradict them as issues, and list requirements or requests in the references that the document does not address as gaps, with the file and page or section.'
    : ' There are no reference files, so leave gaps empty.';
  return [
    {
      role: 'user',
      content: `${guideSections(ctx) || 'No guides are selected; review for clarity and consistency.'}\n\n<document>\n${document}\n</document>\n\nReview the document against the guides. Report places that break them and need judgement: tone, voice, structure, claims without support, unclear sentences. Mechanical points (punctuation, spelling, number style) are already checked separately, so skip them. Quote the exact text for each issue so it can be located.${references} Respond with JSON matching {"issues":[{"quote":"…","message":"…","suggestion":"…"}],"gaps":[{"requirement":"…","source":"…"}]}; use empty lists when nothing needs attention.`,
    },
  ];
}

export function parseReviewGaps(text: string): ReviewGap[] {
  const data = extractJson(text) as { gaps?: unknown } | null;
  if (!data || !Array.isArray(data.gaps)) return [];
  return data.gaps
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g) => ({ requirement: String(g.requirement ?? ''), source: String(g.source ?? '') }))
    .filter((g) => g.requirement);
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
