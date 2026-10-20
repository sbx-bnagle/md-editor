import { useEffect, useState } from 'react';
import type { FileDiffResult } from '@mde/core';
import { api } from '../api/host';
import { reportError, saveNow } from '../state/actions';
import { setState, toast, useStore } from '../state/store';
import { CloseIcon } from './icons';

export function DiffView() {
  const target = useStore((s) => s.diff)!;
  const version = useStore((s) => s.historyVersion);
  const [result, setResult] = useState<FileDiffResult | null>(null);

  useEffect(() => {
    setResult(null);
    api.history.diff(target.projectPath, target.snapshotId, target.path, target.against).then(setResult).catch(reportError);
  }, [target.projectPath, target.snapshotId, target.path, target.against, version]);

  const restore = async () => {
    const ok = await api.ui.confirm(`Restore “${target.path}” from “${target.snapshotLabel}”?`, 'The current file is saved in history first.', 'Restore File');
    if (!ok) return;
    try {
      await saveNow();
      await api.history.restoreFile(target.projectPath, target.snapshotId, target.path);
      toast('File restored.', 'success');
      setState({ diff: null });
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="diff-view" role="dialog" aria-label="Changes">
      <div className="diff-header">
        <div className="diff-title">
          <strong>{target.path}</strong>
          <span className="diff-sub">{target.snapshotLabel}</span>
        </div>
        <div className="segmented">
          <button className={target.against === 'previous' ? 'on' : ''} onClick={() => setState({ diff: { ...target, against: 'previous' } })}>
            Changes in this version
          </button>
          <button className={target.against === 'current' ? 'on' : ''} onClick={() => setState({ diff: { ...target, against: 'current' } })}>
            Compare with current
          </button>
        </div>
        <button className="button small" onClick={restore}>
          Restore this file
        </button>
        <button className="icon-button" onClick={() => setState({ diff: null })} aria-label="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="diff-body">
        {!result && <div className="panel-empty">Loading…</div>}
        {result?.binary && <div className="panel-empty">{result.same ? 'Identical.' : 'Binary file changed.'}</div>}
        {result && !result.binary && result.hunks.length === 0 && <div className="panel-empty">No differences.</div>}
        {result?.hunks.map((h, i) => (
          <div key={i} className="diff-hunk">
            <div className="diff-hunk-header">
              Line {h.newStart || h.oldStart}
            </div>
            {h.lines.map((l, j) => (
              <div key={j} className={`diff-line ${l.type}`}>
                <span className="diff-no">{l.oldNo ?? ''}</span>
                <span className="diff-no">{l.newNo ?? ''}</span>
                <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                <span className="diff-text">
                  {l.parts ? l.parts.map((p, k) => (p.changed ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>)) : l.text || ' '}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
