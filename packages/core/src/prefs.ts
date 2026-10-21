// User preferences, stored by the host (settings.json). API keys are stored separately,
// encrypted by the host, and never appear here.

import type { AiProviderConfig } from './ai';

export interface Preferences {
  /** Bumped when a default changes in a way stored preferences should pick up. */
  version: number;
  /** Name recorded for text you type (authorship annotations). */
  authorName: string;
  /** CSS font family for the editor. Fonts installed on the Mac can be named here. */
  editorFont: string;
  editorFontSize: number;
  /** Record who wrote what (typed vs AI) in documents that contain AI text. */
  recordAuthorship: boolean;
  /** Show AI-written text dimmed in the editor. */
  showAuthorship: boolean;
  checks: {
    spelling: boolean;
    grammar: boolean;
    style: boolean;
    /** Highlight sentences above the target reading grade. */
    readability: boolean;
  };
  /** Target reading grade when the style guide does not set one. */
  readingGrade: number;
  ai: {
    providers: AiProviderConfig[];
    defaultProvider: string;
  };
}

export const DEFAULT_PROVIDERS: AiProviderConfig[] = [
  { id: 'claude', kind: 'anthropic', name: 'Claude', baseUrl: '', model: 'claude-opus-5-5', effort: 'medium' },
];

export const PROVIDER_PRESETS: Array<Omit<AiProviderConfig, 'id'>> = [
  { kind: 'anthropic', name: 'Claude', baseUrl: '', model: 'claude-opus-5-5', effort: 'medium' },
  { kind: 'openai-compatible', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', effort: 'default' },
  { kind: 'openai-compatible', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', effort: 'default' },
  { kind: 'openai-compatible', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: '', effort: 'default' },
  { kind: 'openai-compatible', name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: '', effort: 'default' },
];

export const PREFERENCES_VERSION = 3;

export function defaultPreferences(userName = ''): Preferences {
  return {
    version: PREFERENCES_VERSION,
    authorName: userName,
    editorFont: 'IBM Plex Mono',
    editorFontSize: 20,
    recordAuthorship: true,
    showAuthorship: true,
    checks: { spelling: true, grammar: true, style: true, readability: false },
    readingGrade: 10,
    ai: { providers: DEFAULT_PROVIDERS.map((p) => ({ ...p })), defaultProvider: 'claude' },
  };
}

/** Merges stored preferences over defaults so new settings get default values. */
export function normalizePreferences(stored: Partial<Preferences> | undefined, userName = ''): Preferences {
  const d = defaultPreferences(userName);
  if (!stored) return d;
  const migrated: Partial<Preferences> = { ...stored };
  // The default editor size went from 15 (version 1) to 18 (version 2) to 20 px (version 3).
  // A stored size equal to the default of its version was never chosen, so it follows the new default.
  const version = stored.version ?? 1;
  if ((version === 1 && stored.editorFontSize === 15) || (version === 2 && stored.editorFontSize === 18)) migrated.editorFontSize = 20;
  return {
    ...d,
    ...migrated,
    version: PREFERENCES_VERSION,
    checks: { ...d.checks, ...(stored.checks ?? {}) },
    ai: {
      providers: stored.ai?.providers?.length ? stored.ai.providers : d.ai.providers,
      defaultProvider: stored.ai?.defaultProvider ?? d.ai.defaultProvider,
    },
  };
}
