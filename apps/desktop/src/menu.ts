import { Menu, app, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '@mde/core';

export function buildMenu(send: (command: MenuCommand) => void, devTools: boolean): Menu {
  const cmd = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(command),
  });
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, cmd('Settings…', 'settings', 'CmdOrCtrl+,'), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [
        cmd('New File…', 'new-file', 'CmdOrCtrl+N'),
        cmd('New Project…', 'new-project', 'CmdOrCtrl+Shift+N'),
        cmd('New Collection…', 'new-collection'),
        cmd('New Template…', 'new-template'),
        { type: 'separator' },
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        { type: 'separator' },
        cmd('Export PDF…', 'export-pdf', 'CmdOrCtrl+Shift+E'),
        cmd('Export ZIP…', 'export-zip'),
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        { type: 'separator' },
        cmd('Convert Quotes and Dashes', 'convert-quotes'),
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd('Toggle Preview', 'toggle-preview', 'CmdOrCtrl+R'),
        cmd('Show or Hide Authorship', 'toggle-authorship', 'CmdOrCtrl+Shift+A'),
        cmd('Insights', 'insights', 'CmdOrCtrl+Shift+I'),
        { type: 'separator' },
        cmd('Zoom In', 'zoom-in', 'CmdOrCtrl+Plus'),
        cmd('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
        cmd('Actual Size', 'zoom-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(devTools ? [{ type: 'separator' } as const, { role: 'toggleDevTools' } as const] : []),
      ],
    },
    {
      label: 'Assistant',
      submenu: [cmd('Ask AI…', 'ai-command', 'CmdOrCtrl+K'), cmd('Chat', 'ai-chat', 'CmdOrCtrl+Alt+K'), { type: 'separator' }, cmd('Review with AI', 'ai-review', 'CmdOrCtrl+Alt+R')],
    },
    {
      label: 'History',
      submenu: [cmd('Create Checkpoint…', 'checkpoint', 'CmdOrCtrl+Alt+S'), cmd('Show History', 'show-history', 'CmdOrCtrl+Alt+H')],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
