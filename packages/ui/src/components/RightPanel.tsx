import { useStore, type PanelId } from '../state/store';
import { AssistantPanel } from './AssistantPanel';
import { HistoryPanel } from './HistoryPanel';
import { InsightsPanel } from './InsightsPanel';

const LABEL: Record<PanelId, string> = {
  assistant: 'Assistant',
  insights: 'Insights',
  history: 'History',
};

/** The side panel, below the top bar; the top bar's Assistant, Insights and History buttons switch it. */
export function RightPanel() {
  const panel = useStore((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="right-panel" aria-label={LABEL[panel]}>
      <div className="panel-body">
        {panel === 'history' && <HistoryPanel />}
        {panel === 'assistant' && <AssistantPanel />}
        {panel === 'insights' && <InsightsPanel />}
      </div>
    </aside>
  );
}
