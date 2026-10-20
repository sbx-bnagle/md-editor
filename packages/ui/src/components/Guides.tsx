import { useEffect, useRef, useState } from 'react';
import { computeDiff, splitFrontMatter } from '@mde/core';
import { acceptVoiceProposal } from '../ai/actions';
import { refreshActiveGuides } from '../ai/context';
import { editorBridge } from '../editor/bridge';
import { loadProject, newGuideDialog, openFile, reportError } from '../state/actions';
import { api } from '../api/host';
import { setState, useStore } from '../state/store';

/** Toolbar menu choosing the voice and style guide for the project or this document. */
export function GuidesMenu() {
  const doc = useStore((s) => s.doc);
  const guides = useStore((s) => s.guides);
  const active = useStore((s) => s.activeGuides);
  const project = useStore((s) => (s.doc?.projectPath ? s.projects[s.doc.projectPath] : undefined));
  const [open, setOpen] = useState(false);
  const [docSel, setDocSel] = useState<{ voice: string | null; style: string | null }>({ voice: null, style: null });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!doc || doc.kind !== 'markdown' || !doc.projectPath) return null;
  const projectPath = doc.projectPath;
  const label = [active.voice?.name, active.style?.name].filter(Boolean).join(' · ') || 'No guides';

  const toggle = () => {
    if (!open) {
      const fm = splitFrontMatter(editorBridge.getText() ?? '').data;
      setDocSel({ voice: typeof fm.voice === 'string' ? fm.voice : null, style: typeof fm.style === 'string' ? fm.style : null });
    }
    setOpen(!open);
  };
  const setProject = async (kind: 'voice' | 'style', name: string | null) => {
    try {
      await api.project.updateMeta(projectPath, { [kind]: name ?? undefined });
      await loadProject(projectPath);
      await refreshActiveGuides();
    } catch (e) {
      reportError(e);
    }
  };
  const setDoc = (kind: 'voice' | 'style', name: string | null) => {
    editorBridge.setFrontMatterValue(kind, name);
    setDocSel((s) => ({ ...s, [kind]: name }));
    setTimeout(() => refreshActiveGuides(), 50);
  };

  const section = (kind: 'voice' | 'style') => {
    const list = guides.filter((g) => g.kind === kind);
    const projectValue = project?.meta[kind] ?? null;
    return (
      <>
        <div className="popover-heading">{kind === 'voice' ? 'Voice' : 'Style guide'} for the project</div>
        <button className={`popover-item${!projectValue ? ' checked' : ''}`} onClick={() => setProject(kind, null)}>
          None
        </button>
        {list.map((g) => (
          <button key={`p-${g.name}`} className={`popover-item${projectValue === g.name ? ' checked' : ''}`} onClick={() => setProject(kind, g.name)}>
            {g.name}
          </button>
        ))}
        <div className="popover-heading">{kind === 'voice' ? 'Voice' : 'Style guide'} for this document</div>
        <button className={`popover-item${!docSel[kind] ? ' checked' : ''}`} onClick={() => setDoc(kind, null)}>
          Use project setting
        </button>
        {list.map((g) => (
          <button key={`d-${g.name}`} className={`popover-item${docSel[kind] === g.name ? ' checked' : ''}`} onClick={() => setDoc(kind, g.name)}>
            {g.name}
          </button>
        ))}
      </>
    );
  };

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="toolbar-button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={`Voice and style guides: ${label}`}>
        <span>{label}</span>
      </button>
      {open && (
        <div className="popover guides-popover" role="menu">
          {section('voice')}
          <div className="popover-separator" />
          {section('style')}
          <div className="popover-separator" />
          {active.voice && (
            <button className="popover-item" onClick={() => (setOpen(false), openFile(active.voice!.path))}>
              Edit voice guide “{active.voice.name}”
            </button>
          )}
          {active.style && (
            <button className="popover-item" onClick={() => (setOpen(false), openFile(active.style!.path))}>
              Edit style guide “{active.style.name}”
            </button>
          )}
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
          <button className="button primary" onClick={acceptVoiceProposal}>
            Apply changes
          </button>
        </div>
      </div>
    </div>
  );
}
