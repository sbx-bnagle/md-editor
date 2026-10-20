import { setState, useStore, type PanelId } from '../state/store';
import { AssistantPanel } from './AssistantPanel';
import { HistoryPanel } from './HistoryPanel';
import { InsightsPanel } from './InsightsPanel';
import { CloseIcon } from './icons';

const TABS: Array<{ id: PanelId; label: string }> = [
  { id: 'assistant', label: 'Assistant' },
  { id: 'insights', label: 'Insights' },
  { id: 'history', label: 'History' },
];

export function RightPanel() {
  const panel = useStore((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="right-panel" aria-label="Side panel">
      <div className="panel-header drag">
        <div className="panel-tabs no-drag" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={panel === t.id} className={panel === t.id ? 'on' : ''} onClick={() => setState({ panel: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="icon-button no-drag" onClick={() => setState({ panel: null })} aria-label="Close panel">
          <CloseIcon />
        </button>
      </div>
      <div className="panel-body">
        {panel === 'history' && <HistoryPanel />}
        {panel === 'assistant' && <AssistantPanel />}
        {panel === 'insights' && <InsightsPanel />}
      </div>
    </aside>
  );
}
