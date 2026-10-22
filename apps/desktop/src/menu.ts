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
        cmd('New Tab', 'new-tab', 'CmdOrCtrl+T'),
        cmd('New Project…', 'new-project', 'CmdOrCtrl+Shift+N'),
        cmd('New Project from Template…', 'new-project-from-template'),
        cmd('New Collection…', 'new-collection'),
        cmd('New Template from Project…', 'new-template'),
        { type: 'separator' },
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        { type: 'separator' },
        cmd('Export PDF…', 'export-pdf', 'CmdOrCtrl+Shift+E'),
        cmd('Export Web Page…', 'export-html', 'CmdOrCtrl+Alt+E'),
        cmd('Export ZIP…', 'export-zip'),
        { type: 'separator' },
        cmd('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
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
        { type: 'separator' },
        cmd('Find and Replace…', 'find-replace', 'CmdOrCtrl+F'),
        cmd('Replace All', 'replace-all', 'CmdOrCtrl+Alt+Enter'),
        cmd('Select All Occurrences', 'select-all-occurrences', 'CmdOrCtrl+Shift+L'),
        cmd('Select Next Occurrence', 'select-next-occurrence', 'CmdOrCtrl+D'),
        { type: 'separator' },
        cmd('Find in Library…', 'find-in-library', 'CmdOrCtrl+Shift+F'),
      ],
    },
    {
      label: 'Format',
      submenu: [cmd('Bold', 'format-bold', 'CmdOrCtrl+B'), cmd('Italic', 'format-italic', 'CmdOrCtrl+I'), cmd('Mark', 'format-mark', 'CmdOrCtrl+M')],
    },
    {
      label: 'View',
      submenu: [
        cmd('Toggle Library', 'toggle-library', 'CmdOrCtrl+E'),
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
    {
      role: 'windowMenu',
      submenu: [
        // ⌘M is Format › Mark.
        { role: 'minimize', accelerator: 'CmdOrCtrl+Alt+M' },
        { role: 'zoom' },
        { type: 'separator' },
        cmd('Show Previous Tab', 'previous-tab', 'CmdOrCtrl+Shift+['),
        cmd('Show Next Tab', 'next-tab', 'CmdOrCtrl+Shift+]'),
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
