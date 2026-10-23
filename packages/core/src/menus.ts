// The app's menus as data. The Mac app builds its menu bar from them (apps/desktop/src/menu.ts);
// the iPad app builds its menu bar and its keyboard shortcuts from them (apps/ipad).

import type { MenuCommand } from './api';

/** Standard items the host supplies itself (Electron roles; the iPad host keeps those it has). */
export type MenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'selectAll'
  | 'close'
  | 'togglefullscreen'
  | 'minimize'
  | 'zoom'
  | 'front';

export type MenuEntry =
  | { command: MenuCommand; label: string; accelerator?: string }
  | { role: MenuRole; label?: string; accelerator?: string }
  | { separator: true };

export interface MenuSection {
  /** Shown as the menu's title; the app menu (role 'appMenu') takes the app's name instead. */
  label: string;
  role?: 'appMenu' | 'windowMenu';
  items: MenuEntry[];
}

const cmd = (label: string, command: MenuCommand, accelerator?: string): MenuEntry => ({ label, command, ...(accelerator ? { accelerator } : {}) });
const sep: MenuEntry = { separator: true };

/** Accelerators are written as Electron writes them ("CmdOrCtrl+Shift+E"). */
export const APP_MENUS: MenuSection[] = [
  {
    label: 'Folio Dome',
    role: 'appMenu',
    items: [{ role: 'about' }, sep, cmd('Settings…', 'settings', 'CmdOrCtrl+,'), sep, { role: 'services' }, sep, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' }],
  },
  {
    label: 'File',
    items: [
      cmd('New File…', 'new-file', 'CmdOrCtrl+N'),
      cmd('New Tab', 'new-tab', 'CmdOrCtrl+T'),
      cmd('New Project…', 'new-project', 'CmdOrCtrl+Shift+N'),
      cmd('New Project from Template…', 'new-project-from-template'),
      cmd('New Collection…', 'new-collection'),
      cmd('New Template from Project…', 'new-template'),
      sep,
      cmd('Save', 'save', 'CmdOrCtrl+S'),
      sep,
      cmd('Export PDF…', 'export-pdf', 'CmdOrCtrl+Shift+E'),
      cmd('Export Web Page…', 'export-html', 'CmdOrCtrl+Alt+E'),
      cmd('Export ZIP…', 'export-zip'),
      sep,
      cmd('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
      { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { role: 'undo' },
      { role: 'redo' },
      sep,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'selectAll' },
      sep,
      cmd('Convert Quotes and Dashes', 'convert-quotes'),
      sep,
      cmd('Find and Replace…', 'find-replace', 'CmdOrCtrl+F'),
      cmd('Replace All', 'replace-all', 'CmdOrCtrl+Alt+Enter'),
      cmd('Select All Occurrences', 'select-all-occurrences', 'CmdOrCtrl+Shift+L'),
      cmd('Select Next Occurrence', 'select-next-occurrence', 'CmdOrCtrl+D'),
      sep,
      cmd('Find in Library…', 'find-in-library', 'CmdOrCtrl+Shift+F'),
    ],
  },
  {
    label: 'Format',
    items: [cmd('Bold', 'format-bold', 'CmdOrCtrl+B'), cmd('Italic', 'format-italic', 'CmdOrCtrl+I'), cmd('Mark', 'format-mark', 'CmdOrCtrl+M')],
  },
  {
    label: 'View',
    items: [
      cmd('Toggle Library', 'toggle-library', 'CmdOrCtrl+E'),
      cmd('Toggle Preview', 'toggle-preview', 'CmdOrCtrl+R'),
      cmd('Show or Hide Authorship', 'toggle-authorship', 'CmdOrCtrl+Shift+A'),
      cmd('Insights', 'insights', 'CmdOrCtrl+Shift+I'),
      sep,
      cmd('Zoom In', 'zoom-in', 'CmdOrCtrl+Plus'),
      cmd('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
      cmd('Actual Size', 'zoom-reset', 'CmdOrCtrl+0'),
      sep,
      { role: 'togglefullscreen' },
    ],
  },
  {
    label: 'Assistant',
    items: [cmd('Ask AI…', 'ai-command', 'CmdOrCtrl+K'), cmd('Chat', 'ai-chat', 'CmdOrCtrl+Alt+K'), sep, cmd('Review with AI', 'ai-review', 'CmdOrCtrl+Alt+R')],
  },
  {
    label: 'History',
    items: [cmd('Create Checkpoint…', 'checkpoint', 'CmdOrCtrl+Alt+S'), cmd('Show History', 'show-history', 'CmdOrCtrl+Alt+H')],
  },
  {
    label: 'Window',
    role: 'windowMenu',
    items: [
      // ⌘M is Format › Mark.
      { role: 'minimize', accelerator: 'CmdOrCtrl+Alt+M' },
      { role: 'zoom' },
      sep,
      cmd('Show Previous Tab', 'previous-tab', 'CmdOrCtrl+Shift+['),
      cmd('Show Next Tab', 'next-tab', 'CmdOrCtrl+Shift+]'),
      sep,
      { role: 'front' },
    ],
  },
];

export interface ParsedAccelerator {
  /** KeyboardEvent.code of the key ("KeyE", "Comma", "Equal"). */
  code: string;
  /** The key as typed without modifiers ("e", ",", "+"), for hosts that name keys by character. */
  key: string;
  shift: boolean;
  alt: boolean;
}

const NAMED_KEYS: Record<string, { code: string; key: string }> = {
  ',': { code: 'Comma', key: ',' },
  '-': { code: 'Minus', key: '-' },
  Plus: { code: 'Equal', key: '+' },
  '[': { code: 'BracketLeft', key: '[' },
  ']': { code: 'BracketRight', key: ']' },
  Enter: { code: 'Enter', key: '\r' },
};

/** Reads a "CmdOrCtrl+…" accelerator; null for keys this parser does not know. */
export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split('+');
  // "CmdOrCtrl+Plus" names the plus key; a trailing empty part would mean "+" itself.
  const last = parts.pop();
  if (!last || parts[0] !== 'CmdOrCtrl') return null;
  const mods = new Set(parts.slice(1));
  if ([...mods].some((m) => m !== 'Shift' && m !== 'Alt')) return null;
  let key: { code: string; key: string } | undefined = NAMED_KEYS[last];
  if (!key && /^[A-Z]$/.test(last)) key = { code: `Key${last}`, key: last.toLowerCase() };
  if (!key && /^[0-9]$/.test(last)) key = { code: `Digit${last}`, key: last };
  if (!key) return null;
  return { ...key, shift: mods.has('Shift'), alt: mods.has('Alt') };
}

/** The menu command a ⌘ key press stands for (matched by physical key, as Option changes the typed character). */
export function commandForKey(e: { code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, menus: MenuSection[] = APP_MENUS): MenuCommand | null {
  if (!e.metaKey || e.ctrlKey) return null;
  for (const section of menus) {
    for (const item of section.items) {
      if (!('command' in item) || !item.accelerator) continue;
      const a = parseAccelerator(item.accelerator);
      // ⌘= and ⌘⇧= both zoom in (Electron's "Plus").
      if (a && a.code === e.code && a.alt === e.altKey && (a.shift === e.shiftKey || a.code === 'Equal')) return item.command;
    }
  }
  return null;
}
