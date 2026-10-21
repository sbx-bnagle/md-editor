import type { Preferences } from '@mde/core';
import { api } from '../api/host';
import { reportError } from './actions';
import { getState, setState } from './store';

/** Applies preferences that live outside React (CSS variables for the editor font). */
export function applyPrefsToDom(p: Preferences): void {
  const font = p.editorFont.trim();
  const stack = font ? `${/[\s,]/.test(font) && !/["']/.test(font) ? `"${font}"` : font}, var(--font-mono)` : 'var(--font-mono)';
  document.documentElement.style.setProperty('--font-editor', stack);
  document.documentElement.style.setProperty('--editor-size', `${Math.min(28, Math.max(10, p.editorFontSize || 18))}px`);
}

export async function loadPrefs(): Promise<void> {
  const [prefs, keyStatus] = await Promise.all([api.settings.get(), api.ai.keyStatus().catch(() => ({}))]);
  setState({ prefs, keyStatus });
  applyPrefsToDom(prefs);
}

export async function updatePrefs(patch: Partial<Preferences>): Promise<void> {
  const before = getState().prefs;
  if (before) setState({ prefs: { ...before, ...patch } });
  try {
    const prefs = await api.settings.update(patch);
    setState({ prefs });
    applyPrefsToDom(prefs);
  } catch (e) {
    if (before) setState({ prefs: before });
    reportError(e);
  }
}

export async function refreshKeyStatus(): Promise<void> {
  setState({ keyStatus: await api.ai.keyStatus() });
}
