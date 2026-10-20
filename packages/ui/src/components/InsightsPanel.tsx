import { useEffect, useMemo, useState } from 'react';
import { analyzeHeadline, easeLabel, headingRanges, readability, type ReadabilityReport } from '@mde/core';
import { api } from '../api/host';
import { clearReview, runReview, suggestHeadlines } from '../ai/actions';
import { editorBridge } from '../editor/bridge';
import { updatePrefs } from '../state/prefs';
import { useStore } from '../state/store';

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('.mde-vars, .mde-missing, pre, code, figcaption, .footnotes').forEach((n) => n.remove());
  const blocks: string[] = [];
  doc.querySelectorAll('p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6').forEach((n) => {
    if (n.querySelector('p, li')) return;
    const t = n.textContent?.trim();
    if (t) blocks.push(/^H\d$/.test(n.tagName) ? `# ${t}` : t);
  });
  return blocks.join('\n\n');
}

function goTo(from: number, to: number) {
  const view = editorBridge.view;
  if (!view) return;
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view.focus();
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="metric" title={hint}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function Readability() {
  const doc = useStore((s) => s.doc);
  const prefs = useStore((s) => s.prefs);
  const style = useStore((s) => s.activeGuides.style);
  const stats = useStore((s) => s.stats);
  const [scope, setScope] = useState<'file' | 'document'>('file');
  const [report, setReport] = useState<ReadabilityReport | null>(null);
  const target = style?.readingGrade ?? prefs?.readingGrade ?? 10;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const text = editorBridge.getText() ?? '';
      if (scope === 'file' || !doc || doc.kind !== 'markdown') {
        setReport(readability(text));
        return;
      }
      const r = await api.render.document({ docPath: doc.path, overrides: { [doc.path]: text } }).catch(() => null);
      if (!cancelled && r) setReport(readability(htmlToText(r.html)));
    };
    const t = setTimeout(run, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [scope, doc, stats]);

  if (!doc || doc.kind !== 'markdown') return <div className="panel-empty">Open a markdown document.</div>;
  const hard = report?.sentenceGrades.filter((s) => s.words >= 8 && s.grade > target) ?? [];
  return (
    <section className="insight-section">
      <div className="insight-header">
        <h3>Readability</h3>
        <div className="segmented small">
          <button className={scope === 'file' ? 'on' : ''} onClick={() => setScope('file')}>
            This file
          </button>
          <button className={scope === 'document' ? 'on' : ''} onClick={() => setScope('document')} title="Including content from content blocks">
            Whole document
          </button>
        </div>
      </div>
      {report && report.words > 0 ? (
        <>
          <div className="grade-summary">
            <span className={`grade-badge${report.averageGrade > target ? ' over' : ''}`}>Grade {report.averageGrade.toFixed(1)}</span>
            <span className="grade-target">
              Target {target}
              {style?.readingGrade ? ` (from ${style.name})` : ''}
            </span>
          </div>
          <div className="metrics">
            <Metric label="Reading ease" value={`${report.fleschReadingEase}`} hint={easeLabel(report.fleschReadingEase)} />
            <Metric label="Flesch–Kincaid" value={report.fleschKincaidGrade} />
            <Metric label="Gunning fog" value={report.gunningFog} />
            <Metric label="SMOG" value={report.smog} />
            <Metric label="Coleman–Liau" value={report.colemanLiau} />
            <Metric label="ARI" value={report.ari} />
            <Metric label="Words" value={report.words.toLocaleString()} />
            <Metric label="Sentences" value={report.sentences} />
            <Metric label="Minutes to read" value={report.readingMinutes} />
          </div>
          <p className="insight-note">{easeLabel(report.fleschReadingEase)}. Scores are estimates from sentence length and syllable counts.</p>
          {scope === 'file' && (
            <>
              <label className="checkbox-row">
                <input type="checkbox" checked={!!prefs?.checks.readability} onChange={(e) => prefs && updatePrefs({ checks: { ...prefs.checks, readability: e.target.checked } })} />
                Highlight sentences above grade {target} ({hard.length})
              </label>
              {hard.slice(0, 8).map((s, i) => (
                <button key={i} className="insight-item" onClick={() => goTo(s.from, s.to)}>
                  <span className="insight-item-grade">{Math.round(s.grade)}</span>
                  <span className="insight-item-text">{editorBridge.view?.state.sliceDoc(s.from, Math.min(s.to, s.from + 90))}…</span>
                </button>
              ))}
            </>
          )}
        </>
      ) : (
        <div className="panel-empty">No prose to measure yet.</div>
      )}
    </section>
  );
}

function Headlines() {
  const doc = useStore((s) => s.doc);
  const stats = useStore((s) => s.stats);
  const [open, setOpen] = useState<number | null>(null);
  const [alts, setAlts] = useState<Record<number, { loading: boolean; items: Array<{ text: string; why: string }>; error?: string }>>({});
  const text = editorBridge.getText() ?? '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const headings = useMemo(() => headingRanges(text), [text, stats]);
  if (!doc || doc.kind !== 'markdown') return null;

  const suggest = async (i: number) => {
    const h = headings[i];
    const after = text.slice(h.to, headings[i + 1]?.from ?? text.length);
    setAlts((a) => ({ ...a, [i]: { loading: true, items: [] } }));
    try {
      const items = await suggestHeadlines(h.text, after);
      setAlts((a) => ({ ...a, [i]: { loading: false, items } }));
    } catch (e) {
      setAlts((a) => ({ ...a, [i]: { loading: false, items: [], error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const use = (i: number, replacement: string) => {
    const view = editorBridge.view;
    const h = headingRanges(view?.state.doc.toString() ?? '')[i];
    if (!view || !h) return;
    view.dispatch({ changes: { from: h.from, to: h.to, insert: replacement }, userEvent: 'input.headline' });
  };

  return (
    <section className="insight-section">
      <div className="insight-header">
        <h3>Headlines</h3>
      </div>
      {headings.length === 0 && <div className="panel-empty">No headings in this file.</div>}
      {headings.map((h, i) => {
        const r = analyzeHeadline(h.text);
        const isOpen = open === i;
        return (
          <div key={`${i}-${h.text}`} className={`headline${isOpen ? ' open' : ''}`}>
            <button className="headline-main" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>
              <span className="headline-text">{h.text}</span>
              <span className="headline-scores">
                <span className="score" title="Clarity">
                  <span className="score-bar">
                    <span style={{ width: `${r.clarity}%` }} />
                  </span>
                  Clarity {r.clarity}
                </span>
                <span className="score" title="Engagement">
                  <span className="score-bar">
                    <span style={{ width: `${r.engagement}%` }} />
                  </span>
                  Engagement {r.engagement}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="headline-detail">
                <ul className="headline-notes">
                  {r.notes.map((n, k) => (
                    <li key={k} className={n.kind}>
                      {n.text}
                    </li>
                  ))}
                </ul>
                <div className="headline-actions">
                  <button className="button small" onClick={() => goTo(h.from, h.to)}>
                    Go to heading
                  </button>
                  <button className="button small" onClick={() => suggest(i)} disabled={alts[i]?.loading}>
                    {alts[i]?.loading ? 'Asking AI…' : 'Suggest alternatives'}
                  </button>
                </div>
                {alts[i]?.error && <div className="command-error">{alts[i].error}</div>}
                {alts[i]?.items.map((a, k) => {
                  const ar = analyzeHeadline(a.text);
                  return (
                    <div key={k} className="headline-alt">
                      <div>
                        <div className="headline-alt-text">{a.text}</div>
                        <div className="headline-alt-why">
                          {a.why} · clarity {ar.clarity}, engagement {ar.engagement}
                        </div>
                      </div>
                      <button className="button small" onClick={() => use(i, a.text)}>
                        Use
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <p className="insight-note">Scores come from simple rules (length, vague words, numbers, direct address) and are a prompt for judgement, not a prediction.</p>
    </section>
  );
}

function Review() {
  const review = useStore((s) => s.review);
  const doc = useStore((s) => s.doc);
  const style = useStore((s) => s.activeGuides.style);
  const voice = useStore((s) => s.activeGuides.voice);
  if (!doc || doc.kind !== 'markdown') return null;
  const mine = review && review.docPath === doc.path ? review : null;
  return (
    <section className="insight-section">
      <div className="insight-header">
        <h3>AI review</h3>
        <button className="button small" onClick={runReview} disabled={mine?.running}>
          {mine?.running ? 'Reviewing…' : mine ? 'Review again' : 'Review with AI'}
        </button>
      </div>
      <p className="insight-note">
        Checks the document against {voice || style ? [voice && `the “${voice.name}” voice`, style && `the “${style.name}” style guide`].filter(Boolean).join(' and ') : 'general clarity (no guides selected)'}. The document is sent to the AI service.
      </p>
      {mine?.error && <div className="command-error">{mine.error}</div>}
      {mine && !mine.running && !mine.error && (
        <>
          <div className="review-count">
            {mine.issues.length === 0 ? 'Nothing flagged.' : `${mine.issues.length} suggestion${mine.issues.length === 1 ? '' : 's'}, underlined in amber.`}
            {mine.unplaced > 0 && ` ${mine.unplaced} could not be located in the current text.`}
            {mine.issues.length > 0 && (
              <button className="link-button" onClick={clearReview}>
                Clear
              </button>
            )}
          </div>
          {mine.issues.map((i, k) => (
            <button key={k} className="insight-item" onClick={() => goTo(i.from, i.to)}>
              <span className="insight-item-text">
                <q>{i.quote}</q> {i.message}
              </span>
            </button>
          ))}
        </>
      )}
    </section>
  );
}

export function InsightsPanel() {
  useEffect(() => {
    // Make sure guides reflect the open document when the panel opens.
    import('../ai/context').then((m) => m.refreshActiveGuides()).catch(() => undefined);
  }, []);
  return (
    <div className="insights-panel">
      <Review />
      <Readability />
      <Headlines />
    </div>
  );
}
