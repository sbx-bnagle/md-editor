import { useEffect, useState } from 'react';
import { isWeb } from '../api/host';
import { boot, cycleTab } from '../state/actions';
import { setState, useStore } from '../state/store';
import { Dialog } from './Dialog';
import { ExportDialog } from './ExportDialog';
import { PagePicker } from './PagePicker';
import { ComponentDialog } from './ComponentDialog';
import { SettingsDialog } from './SettingsDialog';
import { VoiceProposal } from './Guides';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';
import { Welcome } from './Welcome';
import { Workspace } from './Workspace';

/** Web app on a tablet held upright or a phone: the library and side panel go over the workspace. */
const NARROW = '(max-width: 1023px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => isWeb && window.matchMedia(NARROW).matches);
  useEffect(() => {
    if (!isWeb) return;
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function App() {
  const booted = useStore((s) => s.booted);
  const library = useStore((s) => s.app?.libraryPath);
  const showLibrary = useStore((s) => s.prefs?.showLibrary !== false);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const narrow = useNarrow();
  useEffect(() => {
    boot();
    // ⌃Tab and ⌃⇧Tab switch tabs, as in browsers (the menu has ⇧⌘] and ⇧⌘[).
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the library drawer (web app, narrow screens) when nothing else is open over it.
      if (e.key === 'Escape' && useStore.getState().drawerOpen && !document.querySelector('.modal-backdrop, .folio-menu-layer')) {
        setState({ drawerOpen: false });
        return;
      }
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
    <div className={`app${library && !showLibrary && !narrow ? ' library-hidden' : ''}${narrow ? ' narrow' : ''}${narrow && drawerOpen ? ' drawer-open' : ''}`}>
      {library ? (
        <>
          {(showLibrary || narrow) && <Sidebar />}
          {narrow && drawerOpen && <div className="drawer-scrim" onClick={() => setState({ drawerOpen: false })} aria-hidden="true" />}
          <Workspace />
        </>
      ) : (
        <Welcome />
      )}
      <Dialog />
      <ExportDialog />
      <PagePicker />
      <ComponentDialog />
      <SettingsDialog />
      <VoiceProposal />
      <Toasts />
    </div>
  );
}
