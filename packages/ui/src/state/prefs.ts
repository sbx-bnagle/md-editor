import type { Preferences } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { reportError } from './actions';
import { getState, setState } from './store';

/** Applies preferences that live outside React (CSS variables for the editor font). */
export function applyPrefsToDom(p: Preferences): void {
  const font = p.editorFont.trim();
  const stack = font ? `${/[\s,]/.test(font) && !/["']/.test(font) ? `"${font}"` : font}, var(--font-mono)` : 'var(--font-mono)';
  document.documentElement.style.setProperty('--font-editor', stack);
  const zoom = Math.min(3, Math.max(0.5, p.editorZoom || 1));
  document.documentElement.style.setProperty('--editor-size', `${Math.min(28, Math.max(10, p.editorFontSize || 22)) * zoom}px`);
  editorBridge.remeasure();
}

export async function loadPrefs(): Promise<void> {
  const [prefs, keyStatus] = await Promise.all([api.settings.get(), api.ai.keyStatus().catch(() => ({}))]);
  setState({ prefs, keyStatus });
  applyPrefsToDom(prefs);
}

let prefsSeq = 0;

export async function updatePrefs(patch: Partial<Preferences>): Promise<void> {
  const before = getState().prefs;
  if (before) setState({ prefs: { ...before, ...patch } });
  // Only the reply to the latest change is applied: an earlier, slower one would undo typing in Settings.
  const seq = ++prefsSeq;
  try {
    const prefs = await api.settings.update(patch);
    if (seq !== prefsSeq) return;
    setState({ prefs });
    applyPrefsToDom(prefs);
  } catch (e) {
    if (seq === prefsSeq && before) setState({ prefs: before });
    reportError(e);
  }
}

export async function refreshKeyStatus(): Promise<void> {
  setState({ keyStatus: await api.ai.keyStatus() });
}
