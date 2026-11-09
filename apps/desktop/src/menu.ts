import { Menu, app, type MenuItemConstructorOptions } from 'electron';
import { APP_MENUS, type MenuCheck, type MenuCommand, type MenuEntry, type Preferences } from '@mde/core';

export function buildMenu(send: (command: MenuCommand) => void, devTools: boolean, prefs: Preferences): Menu {
  const item = (e: MenuEntry): MenuItemConstructorOptions => {
    if ('separator' in e) return { type: 'separator' };
    if ('role' in e) return { role: e.role, ...(e.label ? { label: e.label } : {}), ...(e.accelerator ? { accelerator: e.accelerator } : {}) };
    if (e.checked) return { id: checkId(e.checked), type: 'checkbox', checked: !!prefs[e.checked], label: e.label, accelerator: e.accelerator, click: () => send(e.command) };
    return { label: e.label, accelerator: e.accelerator, click: () => send(e.command) };
  };
  const template: MenuItemConstructorOptions[] = APP_MENUS.map((section) => {
    const submenu = section.items.map(item);
    if (section.label === 'View' && devTools) submenu.push({ type: 'separator' }, { role: 'toggleDevTools' });
    if (section.role === 'appMenu') return { label: app.name, submenu };
    if (section.role === 'windowMenu') return { role: 'windowMenu', submenu };
    return { label: section.label, submenu };
  });
  return Menu.buildFromTemplate(template);
}

const checkId = (pref: MenuCheck) => `check:${pref}`;

/** Puts the menu's checkmarks in line with the preferences (after they change). */
export function updateMenuChecks(prefs: Preferences): void {
  const menu = Menu.getApplicationMenu();
  for (const section of APP_MENUS)
    for (const e of section.items) {
      if (!('command' in e) || !e.checked) continue;
      const item = menu?.getMenuItemById(checkId(e.checked));
      if (item) item.checked = !!prefs[e.checked];
    }
}
