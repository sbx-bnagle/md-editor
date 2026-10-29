// Bridge between the sandboxed UI and the main process. Exposes a generic invoke/subscribe
// transport plus the platform spellchecker; the UI builds a typed AppApi on top of it.

import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';

type Listener = (event: unknown) => void;

contextBridge.exposeInMainWorld('mdeHost', {
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke('mde:invoke', method, args),
  subscribe: (listener: Listener) => {
    const handler = (_e: unknown, event: unknown) => listener(event);
    ipcRenderer.on('mde:event', handler);
    return () => ipcRenderer.removeListener('mde:event', handler);
  },
  spell: {
    check: (words: string[]) => words.filter((w) => webFrame.isWordMisspelled(w)),
    suggest: (word: string) => webFrame.getWordSuggestions(word),
  },
  platform: process.platform,
  /** The path of a file dropped on the window (from Finder); '' for one that is not on disk. */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
