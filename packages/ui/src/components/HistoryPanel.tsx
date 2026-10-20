import { useEffect, useState } from 'react';
import { paths, type SnapshotChangeInfo, type SnapshotInfo } from '@mde/core';
import { api } from '../api/host';
import { checkpointDialog, currentProject, reportError, saveNow } from '../state/actions';
import { setState, toast, useStore } from '../state/store';
import { CloseIcon, RestoreIcon } from './icons';

const KIND_LABEL: Record<SnapshotInfo['kind'], string> = { auto: 'Auto', checkpoint: 'Checkpoint', export: 'Export', restore: 'Restore' };

function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function snapshotLabel(s: SnapshotInfo): string {
  return s.name ?? `${KIND_LABEL[s.kind]} · ${new Date(s.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function HistoryPanel() {
  const docProject = useStore((s) => s.doc?.projectPath ?? null);
  const selected = useStore((s) => s.selected);
  const version = useStore((s) => s.historyVersion);
  const [project, setProject] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ project: string; items: SnapshotInfo[] } | null>(null);
  const list = loaded && loaded.project === project ? loaded.items : null;
  const [openId, setOpenId] = useState<string | null>(null);
  const [changes, setChanges] = useState<SnapshotChangeInfo[] | null>(null);
  const [showAuto, setShowAuto] = useState(true);

  useEffect(() => {
    currentProject().then(setProject);
  }, [docProject, selected]);

  useEffect(() => {
    setOpenId(null);
  }, [project]);

  useEffect(() => {
    if (!project) {
      setLoaded(null);
      return;
    }
    api.history
      .list(project)
      .then((items) => setLoaded({ project, items }))
      .catch(reportError);
  }, [project, version]);

  useEffect(() => {
    setChanges(null);
    if (project && openId && list?.some((s) => s.id === openId)) api.history.changes(project, openId).then(setChanges).catch(reportError);
  }, [project, openId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const restoreProject = async (s: SnapshotInfo) => {
    if (!project) return;
    const ok = await api.ui.confirm(
      `Restore “${paths.basename(project)}” to “${snapshotLabel(s)}”?`,
      'Files are replaced with this version. The current state is saved in history first, so this can be undone.',
      'Restore',
    );
    if (!ok) return;
    try {
      await saveNow();
      await api.history.restoreProject(project, s.id);
      toast('Project restored.', 'success');
    } catch (e) {
      reportError(e);
    }
  };

  const visible = (list ?? []).filter((s) => showAuto || s.kind !== 'auto');
  let lastDay = '';

  return (
    <aside className="history-panel" aria-label="Version history">
      <div className="panel-header drag">
        <span className="panel-title">History</span>
        <button className="icon-button no-drag" onClick={() => setState({ historyOpen: false })} aria-label="Close history">
          <CloseIcon />
        </button>
      </div>
      {!project && <div className="panel-empty">Open a project document to see its history.</div>}
      {project && (
        <>
          <div className="panel-subheader">
            <span className="panel-project" title={project}>
              {paths.basename(project)}
            </span>
            <button className="button small" onClick={checkpointDialog}>
              Checkpoint…
            </button>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} />
            Show automatic versions
          </label>
          <div className="history-list">
            {list && visible.length === 0 && <div className="panel-empty">No versions yet.</div>}
            {visible.map((s) => {
              const day = dayLabel(s.time);
              const header = day !== lastDay ? <div className="history-day">{day}</div> : null;
              lastDay = day;
              const open = openId === s.id;
              return (
                <div key={s.id}>
                  {header}
                  <div className={`history-item kind-${s.kind}${open ? ' open' : ''}`}>
                    <button className="history-item-main" onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open}>
                      <span className="history-time">{new Date(s.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="history-name">{s.name ?? KIND_LABEL[s.kind]}</span>
                      <span className="history-meta">
                        <span className={`kind-badge ${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                        {s.id === list?.[list.length - 1]?.id
                          ? `First version · ${s.fileCount} file${s.fileCount === 1 ? '' : 's'}`
                          : s.changeCount > 0
                            ? `${s.changeCount} file${s.changeCount === 1 ? '' : 's'} changed`
                            : 'No file changes'}
                      </span>
                    </button>
                    {open && (
                      <div className="history-detail">
                        {changes === null && <div className="panel-empty">Loading…</div>}
                        {changes?.map((c) => (
                          <button
                            key={c.path}
                            className="history-file"
                            onClick={() =>
                              setState({ diff: { projectPath: project, snapshotId: s.id, snapshotLabel: snapshotLabel(s), path: c.path, against: 'previous' } })
                            }
                            title="Show changes"
                          >
                            <span className={`change-dot ${c.status}`} aria-label={c.status} />
                            <span className="history-file-name">{c.path}</span>
                          </button>
                        ))}
                        <button className="button small restore" onClick={() => restoreProject(s)}>
                          <RestoreIcon size={13} /> Restore this version…
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
