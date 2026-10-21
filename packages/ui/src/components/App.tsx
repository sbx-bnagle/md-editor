import { useEffect } from 'react';
import { boot } from '../state/actions';
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
  useEffect(() => {
    boot();
  }, []);
  if (!booted) return <div className="app loading drag" />;
  return (
    <div className="app">
      {library ? (
        <>
          <Sidebar />
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
