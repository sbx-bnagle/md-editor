import { useCallback, useState } from 'react';
import { computeDiff, splitFrontMatter, type GuideInfo } from '@mde/core';
import { acceptVoiceProposal } from '../ai/actions';
import { refreshActiveGuides } from '../ai/context';
import { editorBridge } from '../editor/bridge';
import { loadProject, newGuideDialog, openFile, renameDialog, reportError, trashPath } from '../state/actions';
import { FILES_APP, api } from '../api/host';
import { setState, useStore } from '../state/store';
import { nativeMenu, separator, useOutsideClose } from './popover';

/** Bottom bar menu: choose the voice and style guide for the project or this document, edit a guide, or create one. */
export function GuidesMenu() {
  const doc = useStore((s) => s.doc);
  const guides = useStore((s) => s.guides);
  const active = useStore((s) => s.activeGuides);
  const project = useStore((s) => (s.doc?.projectPath ? s.projects[s.doc.projectPath] : undefined));
  const [open, setOpen] = useState(false);
  const [docSel, setDocSel] = useState<{ voice: string | null; style: string | null }>({ voice: null, style: null });
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);

  const projectPath = doc && doc.kind === 'markdown' ? doc.projectPath : undefined;
  const names = [active.voice?.name, active.style?.name].filter(Boolean).join(' · ');
  const label = projectPath ? `Guides: ${names || 'none'}` : 'Guides';

  const toggle = () => {
    if (!open && projectPath) {
      const fm = splitFrontMatter(editorBridge.getText() ?? '').data;
      setDocSel({ voice: typeof fm.voice === 'string' ? fm.voice : null, style: typeof fm.style === 'string' ? fm.style : null });
    }
    setOpen(!open);
  };
  const setProject = async (kind: GuideInfo['kind'], name: string | null) => {
    if (!projectPath) return;
    try {
      await api.project.updateMeta(projectPath, { [kind]: name ?? undefined });
      await loadProject(projectPath);
      await refreshActiveGuides();
    } catch (e) {
      reportError(e);
    }
  };
  const setDoc = (kind: GuideInfo['kind'], name: string | null) => {
    editorBridge.setFrontMatterValue(kind, name);
    setDocSel((s) => ({ ...s, [kind]: name }));
    setTimeout(() => refreshActiveGuides(), 50);
  };
  const edit = (g: GuideInfo) => {
    setOpen(false);
    openFile(g.path);
  };
  const guideContextMenu = (g: GuideInfo) =>
    nativeMenu(
      [
        { id: 'edit', label: 'Edit' },
        { id: 'dup', label: 'Duplicate…' },
        separator,
        { id: 'rename', label: 'Rename…' },
        { id: 'reveal', label: `Show in ${FILES_APP}` },
        separator,
        { id: 'trash', label: 'Move to Trash' },
      ],
      {
        edit: () => edit(g),
        dup: () => (setOpen(false), newGuideDialog(g.kind, g.name)),
        rename: () => (setOpen(false), renameDialog(g.path)),
        reveal: () => api.library.reveal(g.path),
        trash: () => (setOpen(false), trashPath(g.path)),
      },
    );

  const select = (kind: GuideInfo['kind']) => {
    const list = guides.filter((g) => g.kind === kind);
    const projectValue = project?.meta[kind] ?? null;
    const noun = kind === 'voice' ? 'Voice' : 'Style guide';
    return (
      <>
        <div className="popover-heading">{noun} for the project</div>
        <button className={`popover-item${!projectValue ? ' checked' : ''}`} onClick={() => setProject(kind, null)}>
          None
        </button>
        {list.map((g) => (
          <button key={`p-${g.name}`} className={`popover-item${projectValue === g.name ? ' checked' : ''}`} onClick={() => setProject(kind, g.name)}>
            {g.name}
          </button>
        ))}
        <div className="popover-heading">{noun} for this document</div>
        <button className={`popover-item${!docSel[kind] ? ' checked' : ''}`} onClick={() => setDoc(kind, null)}>
          Use project setting
        </button>
        {list.map((g) => (
          <button key={`d-${g.name}`} className={`popover-item${docSel[kind] === g.name ? ' checked' : ''}`} onClick={() => setDoc(kind, g.name)}>
            {g.name}
          </button>
        ))}
        <div className="popover-separator" />
      </>
    );
  };
  const editList = (kind: GuideInfo['kind']) => (
    <>
      <div className="popover-heading">Edit {kind === 'voice' ? 'voice' : 'style'} guide</div>
      {guides
        .filter((g) => g.kind === kind)
        .map((g) => (
          <button key={`e-${g.path}`} className="popover-item" onClick={() => edit(g)} onContextMenu={(e) => (e.preventDefault(), guideContextMenu(g))} title="Edit (right-click for more)">
            {g.name}
          </button>
        ))}
    </>
  );

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="status-button guides-button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={projectPath ? `Voice and style guides: ${names || 'none'}` : 'Voice and style guides'}>
        {label}
      </button>
      {open && (
        <div className="popover up guides-popover" role="menu">
          {projectPath && select('voice')}
          {projectPath && select('style')}
          {editList('voice')}
          {editList('style')}
          <div className="popover-separator" />
          <button className="popover-item" onClick={() => (setOpen(false), newGuideDialog('voice'))}>
            New voice guide…
          </button>
          <button className="popover-item" onClick={() => (setOpen(false), newGuideDialog('style'))}>
            New style guide…
          </button>
        </div>
      )}
    </div>
  );
}

/** Review screen for AI-proposed changes to a voice guide. */
export function VoiceProposal() {
  const proposal = useStore((s) => s.voiceProposal);
  if (!proposal) return null;
  const hunks = computeDiff(proposal.current, proposal.proposed, 2);
  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Proposed voice guide changes">
        <h2>Proposed changes to the voice guide</h2>
        <p className="modal-message">
          {proposal.added} line{proposal.added === 1 ? '' : 's'} added, {proposal.removed} removed. Nothing changes until you apply them.
        </p>
        <div className="diff-body modal-diff">
          {hunks.map((h, i) => (
            <div key={i} className="diff-hunk">
              {h.lines.map((l, j) => (
                <div key={j} className={`diff-line ${l.type}`}>
                  <span className="diff-no">{l.oldNo ?? ''}</span>
                  <span className="diff-no">{l.newNo ?? ''}</span>
                  <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                  <span className="diff-text">{l.parts ? l.parts.map((p, k) => (p.changed ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>)) : l.text || ' '}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button" onClick={() => setState({ voiceProposal: null })}>
            Discard
          </button>
          <button className="button primary" onClick={() => acceptVoiceProposal().catch(reportError)}>
            Apply changes
          </button>
        </div>
      </div>
    </div>
  );
}
