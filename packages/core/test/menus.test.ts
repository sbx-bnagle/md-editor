import { describe, expect, it } from 'vitest';
import { APP_MENUS, commandForKey, parseAccelerator } from '../src/menus';

const key = (code: string, mods: { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean } = {}) => ({
  code,
  metaKey: mods.meta ?? true,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe('menus', () => {
  it('parses every accelerator in the menus', () => {
    for (const section of APP_MENUS) {
      for (const item of section.items) {
        if ('accelerator' in item && item.accelerator) expect(parseAccelerator(item.accelerator), item.accelerator).not.toBeNull();
      }
    }
    expect(parseAccelerator('CmdOrCtrl+Shift+E')).toEqual({ code: 'KeyE', key: 'e', shift: true, alt: false });
    expect(parseAccelerator('CmdOrCtrl+Alt+Enter')).toEqual({ code: 'Enter', key: '\r', shift: false, alt: true });
    expect(parseAccelerator('CmdOrCtrl+,')).toEqual({ code: 'Comma', key: ',', shift: false, alt: false });
    expect(parseAccelerator('F5')).toBeNull();
  });

  it('gives each shortcut one command', () => {
    const seen = new Map<string, string>();
    for (const section of APP_MENUS) {
      for (const item of section.items) {
        if (!('accelerator' in item) || !item.accelerator) continue;
        const a = parseAccelerator(item.accelerator)!;
        const id = `${a.code}/${a.shift}/${a.alt}`;
        expect(seen.get(id), item.accelerator).toBeUndefined();
        seen.set(id, item.accelerator);
      }
    }
  });

  it('matches key presses by physical key', () => {
    expect(commandForKey(key('KeyS'))).toBe('save');
    expect(commandForKey(key('KeyE', { shift: true }))).toBe('export-pdf');
    // Option+E types a dead key; the physical key still matches.
    expect(commandForKey(key('KeyE', { alt: true }))).toBe('export-html');
    expect(commandForKey(key('Equal'))).toBe('zoom-in');
    expect(commandForKey(key('Equal', { shift: true }))).toBe('zoom-in');
    expect(commandForKey(key('BracketRight', { shift: true }))).toBe('next-tab');
    expect(commandForKey(key('KeyS', { meta: false, ctrl: true }))).toBeNull();
    expect(commandForKey(key('KeyZ'))).toBeNull();
  });
});
