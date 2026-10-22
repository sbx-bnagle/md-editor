import { useEffect } from 'react';
import { boot, cycleTab } from '../state/actions';
import { useStore } from '../state/store';
import { Dialog } from './Dialog';
import { ExportDialog } from './ExportDialog';
import { PagePicker } from './PagePicker';
import { SettingsDialog } from './SettingsDialog';
import { VoiceProposal } from './Guides';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';
import { Welcome } from './Welcome';
import { Workspace } from './Workspace';

export function App() {
  const booted = useStore((s) => s.booted);
  const library = useStore((s) => s.app?.libraryPath);
  const showLibrary = useStore((s) => s.prefs?.showLibrary !== false);
  useEffect(() => {
    boot();
    // ⌃Tab and ⌃⇧Tab switch tabs, as in browsers (the menu has ⇧⌘] and ⇧⌘[).
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        cycleTab(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  if (!booted) return <div className="app loading drag" />;
  return (
    <div className={`app${library && !showLibrary ? ' library-hidden' : ''}`}>
      {library ? (
        <>
          {showLibrary && <Sidebar />}
          <Workspace />
        </>
      ) : (
        <Welcome />
      )}
      <Dialog />
      <ExportDialog />
      <PagePicker />
      <SettingsDialog />
      <VoiceProposal />
      <Toasts />
    </div>
  );
}
