import { useEffect, useRef, useState } from 'react';
import { paths } from '@mde/core';
import { editorBridge } from '../editor/bridge';
import { balanced, bodyForEditing, bodyFromEditing, cssRules, type CssRule, type Inspection, type RuleMatch } from '../preview/cssRules';
import { requestRender, setMode } from '../state/actions';

const WIDTH = 380;

interface Props {
  inspection: Inspection;
  /** Where the element was double-clicked, in the preview's coordinates. */
  anchor: { x: number; y: number };
  host: { width: number; height: number };
  cssPath: string;
  onClose(): void;
}

/** Writes edited declarations into the open theme CSS (found again by position and selector, as the text may have moved). */
function applyBody(rule: CssRule, edited: string): string | null {
  const view = editorBridge.view;
  const text = editorBridge.getText();
  if (!view || text === null) return 'The theme’s CSS is not open.';
  if (!balanced(edited)) return 'The braces { } or a comment do not close; the change is applied once they do.';
  const now = cssRules(text)[rule.index];
  if (!now || now.selector !== rule.selector || now.kind !== rule.kind) return 'The CSS has changed; double-click the element again.';
  view.dispatch({ changes: { from: now.bodyFrom, to: now.bodyTo, insert: bodyFromEditing(text, now, edited) }, userEvent: 'input.inspector' });
  requestRender();
  return null;
}

/** Opens the CSS editor at a rule. */
function goToRule(rule: CssRule): void {
  setMode('edit');
  setTimeout(() => editorBridge.revealLine(rule.line - 1), 0);
}

function RuleCard({ match, file, autoFocus }: { match: RuleMatch; file: string; autoFocus?: boolean }) {
  const { rule } = match;
  const [value, setValue] = useState(() => bodyForEditing(editorBridge.getText() ?? '', rule));
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) area.current?.focus();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [autoFocus]);
  const change = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    // Applied after a pause in typing: each change lays the preview out again.
    timer.current = setTimeout(() => setError(applyBody(rule, next)), 450);
  };
  const lines = Math.min(14, Math.max(2, value.split('\n').length + 1));
  return (
    <div className="rule-card">
      <div className="rule-head">
        <code className="rule-selector">{rule.selector}</code>
        {match.pseudo && <span className="rule-pseudo">{match.pseudo}</span>}
        <button className="link-button rule-where" onClick={() => goToRule(rule)} title="Show this rule in the CSS editor">
          {file}:{rule.line}
        </button>
      </div>
      {rule.context.length > 0 && <div className="rule-context">in {rule.context.join(' › ')}</div>}
      <textarea
        ref={area}
        className="rule-body"
        aria-label={`Declarations of ${rule.selector}`}
        value={value}
        rows={lines}
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
      {error && <div className="rule-error">{error}</div>}
    </div>
  );
}

/**
 * The theme's CSS rules that apply to an element double-clicked in the theme preview, with their
 * declarations editable in place (written to the theme's CSS, which lays the preview out again).
 */
export function RuleFlyout({ inspection, anchor, host, cssPath, onClose }: Props) {
  const file = paths.basename(cssPath);
  const [showInherited, setShowInherited] = useState(false);
  const [added, setAdded] = useState<RuleMatch[]>([]);
  const left = anchor.x + 16 + WIDTH < host.width ? anchor.x + 16 : Math.max(8, anchor.x - 16 - WIDTH);
  const top = Math.max(8, Math.min(anchor.y - 24, host.height - 240));
  const inheritedCount = inspection.inherited.reduce((n, g) => n + g.matches.length, 0);

  const addRule = () => {
    const view = editorBridge.view;
    const text = editorBridge.getText();
    if (!view || text === null || !inspection.suggestion) return;
    const insert = `${text.endsWith('\n') ? '' : '\n'}\n${inspection.suggestion} {\n  \n}\n`;
    view.dispatch({ changes: { from: text.length, insert }, userEvent: 'input.inspector' });
    const rules = cssRules(editorBridge.getText() ?? '');
    const rule = [...rules].reverse().find((r) => r.kind === 'style' && r.selector === inspection.suggestion);
    if (rule) setAdded((a) => [...a, { rule }]);
  };

  return (
    <div
      className="rule-flyout"
      role="dialog"
      aria-label={`CSS rules for ${inspection.label}`}
      style={{ left, top, width: WIDTH, maxHeight: host.height - top - 8 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="rule-flyout-head">
        <div>
          <div className="rule-flyout-title">{inspection.label}</div>
          <div className="rule-flyout-file">Rules in {file}</div>
        </div>
        <button className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="rule-flyout-body">
        {[...inspection.own, ...added].map((m, i) => (
          <RuleCard key={`${m.rule.index}-${m.pseudo ?? ''}`} match={m} file={file} autoFocus={i >= inspection.own.length} />
        ))}
        {inspection.own.length === 0 && added.length === 0 && <div className="panel-empty">No rule in {file} styles this directly.</div>}
        {inspection.suggestion && ![...inspection.own, ...added].some((m) => !m.pseudo && m.rule.selector === inspection.suggestion && m.rule.context.length === 0) && (
          <button className="button small rule-add" onClick={addRule}>
            Add a rule for <code>{inspection.suggestion}</code>
          </button>
        )}
        {inheritedCount > 0 && (
          <>
            <button className="link-button rule-inherited-toggle" aria-expanded={showInherited} onClick={() => setShowInherited(!showInherited)}>
              {showInherited ? 'Hide' : 'Show'} rules of {inspection.label.startsWith('@') ? 'the page' : 'enclosing elements'} ({inheritedCount})
            </button>
            {showInherited &&
              inspection.inherited.map((g) => (
                <div key={g.from} className="rule-group">
                  <div className="rule-group-title">From {g.from}</div>
                  {g.matches.map((m) => (
                    <RuleCard key={m.rule.index} match={m} file={file} />
                  ))}
                </div>
              ))}
          </>
        )}
        <p className="rule-note">Changes are written to {file} and the preview is laid out again. The app’s default styles and components’ own CSS files are not listed.</p>
      </div>
    </div>
  );
}
