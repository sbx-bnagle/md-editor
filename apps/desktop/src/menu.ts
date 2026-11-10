import { Menu, app, type MenuItemConstructorOptions } from 'electron';
import { APP_MENUS, type MenuCommand, type MenuEntry } from '@mde/core';

export function buildMenu(send: (command: MenuCommand) => void, devTools: boolean): Menu {
  const item = (e: MenuEntry): MenuItemConstructorOptions => {
    if ('separator' in e) return { type: 'separator' };
    if ('role' in e) return { role: e.role, ...(e.label ? { label: e.label } : {}), ...(e.accelerator ? { accelerator: e.accelerator } : {}) };
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
