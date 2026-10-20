import { useEffect } from 'react';
import { boot } from '../state/actions';
import { useStore } from '../state/store';
import { Dialog } from './Dialog';
import { HistoryPanel } from './HistoryPanel';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';
import { Welcome } from './Welcome';
import { Workspace } from './Workspace';

export function App() {
  const booted = useStore((s) => s.booted);
  const library = useStore((s) => s.app?.libraryPath);
  const historyOpen = useStore((s) => s.historyOpen);
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
          {historyOpen && <HistoryPanel />}
        </>
      ) : (
        <Welcome />
      )}
      <Dialog />
      <Toasts />
    </div>
  );
}
