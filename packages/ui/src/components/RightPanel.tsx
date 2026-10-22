import { setState, useStore, type PanelId } from '../state/store';
import { AssistantPanel } from './AssistantPanel';
import { HistoryPanel } from './HistoryPanel';
import { InsightsPanel } from './InsightsPanel';
import { ClockIcon } from './icons';

const LABEL: Record<PanelId, string> = {
  assistant: 'Assistant',
  insights: 'Insights',
  history: 'History',
};

const PANELS = [
  ['assistant', '⌥⌘K'],
  ['insights', '⇧⌘I'],
  ['history', '⌥⌘H'],
] as const;

/**
 * Assistant, Insights and History: buttons in the top bar while the side panel is closed, tabs at
 * the top of the panel while it is open. Choosing the open one closes the panel.
 */
export function PanelTabs() {
  const panel = useStore((s) => s.panel);
  const tabs = !!panel;
  return (
    <div className={`segmented panel-toggles no-drag${tabs ? ' as-tabs' : ''}`} role={tabs ? 'tablist' : 'group'} aria-label="Side panel">
      {PANELS.map(([id, key]) => (
        <button
          key={id}
          className={panel === id ? 'on' : ''}
          onClick={() => setState({ panel: panel === id ? null : id })}
          {...(tabs ? { role: 'tab', 'aria-selected': panel === id } : { 'aria-pressed': false })}
          title={`${LABEL[id]} (${key})`}
          aria-label={LABEL[id]}
        >
          {id === 'history' ? <ClockIcon /> : LABEL[id]}
        </button>
      ))}
    </div>
  );
}

/** The side panel: full height, with its tabs in its own top bar; its content scrolls behind that bar. */
export function RightPanel() {
  const panel = useStore((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="right-panel" aria-label={LABEL[panel]}>
      <div className="panel-top drag">
        <PanelTabs />
      </div>
      <div className="panel-body">
        {panel === 'history' && <HistoryPanel />}
        {panel === 'assistant' && <AssistantPanel />}
        {panel === 'insights' && <InsightsPanel />}
      </div>
    </aside>
  );
}
