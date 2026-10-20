import { useEffect, useRef, useState } from 'react';
import { paths, splitFrontMatter, type ComposeWarning } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { customizeTheme, exportPdfDialog, openFile, requestRender, setMode, setProjectTheme, zoomBy } from '../state/actions';
import { setState, useStore } from '../state/store';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { ClockIcon, ExportIcon, ThemeIcon, WarningIcon } from './icons';
import { DiffView } from './DiffView';

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function ThemeMenu() {
  const doc = useStore((s) => s.doc);
  const project = useStore((s) => (s.doc?.projectPath ? s.projects[s.doc.projectPath] : undefined));
  const render = useStore((s) => s.render);
  const [open, setOpen] = useState(false);
  const [docTheme, setDocTheme] = useState<string | null>(null);
  const ref = useOutsideClose(open, () => setOpen(false));
  if (!doc || doc.kind !== 'markdown' || !doc.projectPath) return null;
  const projectTheme = project?.meta.theme ?? 'Classic';
  const themes = project?.themes ?? [];
  const label = docTheme ?? render?.themeName ?? projectTheme;
  const activeTheme = themes.find((t) => t.name === (docTheme ?? projectTheme));

  const toggle = () => {
    if (!open) {
      const text = editorBridge.getText() ?? '';
      const t = splitFrontMatter(text).data.theme;
      setDocTheme(typeof t === 'string' ? t : null);
    }
    setOpen(!open);
  };
  const setDoc = (name: string | null) => {
    editorBridge.setFrontMatterValue('theme', name);
    setDocTheme(name);
    if (useStore.getState().mode === 'preview') setTimeout(requestRender, 50);
  };

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="toolbar-button" onClick={toggle} title="Theme" aria-haspopup="menu" aria-expanded={open}>
        <ThemeIcon />
        <span>{label}</span>
      </button>
      {open && (
        <div className="popover theme-popover" role="menu">
          <div className="popover-heading">Project theme</div>
          {themes.map((t) => (
            <button key={`p-${t.name}`} className={`popover-item${projectTheme === t.name ? ' checked' : ''}`} onClick={() => setProjectTheme(doc.projectPath!, t.name)}>
              {t.name}
              {t.scope === 'project' && <span className="badge">customized</span>}
            </button>
          ))}
          <div className="popover-heading">This document</div>
          <button className={`popover-item${!docTheme ? ' checked' : ''}`} onClick={() => setDoc(null)}>
            Use project theme
          </button>
          {themes.map((t) => (
            <button key={`d-${t.name}`} className={`popover-item${docTheme === t.name ? ' checked' : ''}`} onClick={() => setDoc(t.name)}>
              {t.name}
            </button>
          ))}
          <div className="popover-separator" />
          {activeTheme &&
            (activeTheme.scope === 'project' ? (
              <button className="popover-item" onClick={() => (setOpen(false), openFile(activeTheme.cssPath))}>
                Edit this project’s “{activeTheme.name}” CSS
              </button>
            ) : (
              <>
                <button className="popover-item" onClick={() => (setOpen(false), customizeTheme(doc.projectPath!, activeTheme.name))}>
                  Customize “{activeTheme.name}” for this project
                </button>
                <button className="popover-item" onClick={() => (setOpen(false), openFile(activeTheme.cssPath))}>
                  Edit library theme “{activeTheme.name}”
                </button>
              </>
            ))}
        </div>
      )}
    </div>
  );
}

function WarningsButton() {
  const render = useStore((s) => s.render);
  const mode = useStore((s) => s.mode);
  const open = useStore((s) => s.warningsOpen);
  const ref = useOutsideClose(open, () => setState({ warningsOpen: false }));
  const warnings = render?.warnings ?? [];
  if (mode !== 'preview' || warnings.length === 0) return null;
  const libRoot = useStore.getState().tree?.root ?? '';
  const where = (w: ComposeWarning) => `${paths.relative(libRoot, w.source).split('/').slice(-2).join('/')}${w.line !== undefined ? `:${w.line + 1}` : ''}`;
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="toolbar-button warn" onClick={() => setState({ warningsOpen: !open })} title="Problems">
        <WarningIcon />
        <span>{warnings.length}</span>
      </button>
      {open && (
        <div className="popover warnings-popover">
          {warnings.map((w, i) => (
            <div key={i} className="warning-item">
              <div>{w.message}</div>
              <div className="warning-where">{where(w)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toolbar() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const tree = useStore((s) => s.tree);
  const historyOpen = useStore((s) => s.historyOpen);
  const rendering = useStore((s) => s.rendering);
  const pageCount = useStore((s) => s.pageCount);
  const zoom = useStore((s) => s.zoom);
  const crumbs = doc && tree ? paths.relative(tree.root, doc.path).split('/').filter((c) => c !== 'Collections' && c !== '.mdeditor') : [];
  const canPreview = doc && (doc.kind === 'markdown' || doc.kind === 'css');
  return (
    <div className="toolbar drag">
      <div className="breadcrumbs no-drag" title={doc?.path}>
        {crumbs.map((c, i) => (
          <span key={i} className={i === crumbs.length - 1 ? 'crumb current' : 'crumb'}>
            {c}
          </span>
        ))}
      </div>
      <div className="toolbar-actions no-drag">
        {canPreview && (
          <div className="segmented" role="tablist" aria-label="View">
            <button role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} title="Edit (⌘R toggles)">
              {doc?.kind === 'css' ? 'CSS' : 'Markdown'}
            </button>
            <button role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')} title="Preview (⌘R toggles)">
              Preview
            </button>
          </div>
        )}
        {mode === 'preview' && canPreview && (
          <div className="zoom-controls">
            <button className="icon-button" onClick={() => zoomBy(-0.1)} title="Zoom out">
              −
            </button>
            <button className="zoom-label" onClick={() => zoomBy(null)} title="Actual size">
              {Math.round(zoom * 100)}%
            </button>
            <button className="icon-button" onClick={() => zoomBy(0.1)} title="Zoom in">
              +
            </button>
            <span className="page-count">{rendering ? 'Laying out…' : pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : ''}</span>
          </div>
        )}
        <WarningsButton />
        <ThemeMenu />
        {doc?.kind === 'markdown' && (
          <button className="toolbar-button" onClick={() => exportPdfDialog({ docPath: doc.path })} title="Export PDF (⇧⌘E)">
            <ExportIcon />
            <span>PDF</span>
          </button>
        )}
        <button className={`toolbar-button${historyOpen ? ' on' : ''}`} onClick={() => setState({ historyOpen: !historyOpen })} title="History (⌥⌘H)" aria-pressed={historyOpen}>
          <ClockIcon />
        </button>
      </div>
    </div>
  );
}

function StatusBar() {
  const doc = useStore((s) => s.doc);
  const stats = useStore((s) => s.stats);
  const dirty = useStore((s) => s.dirty);
  const saving = useStore((s) => s.saving);
  if (!doc || (doc.kind !== 'markdown' && doc.kind !== 'css' && doc.kind !== 'text')) return <div className="statusbar" />;
  const authors = doc.annotations?.authors ?? [];
  return (
    <div className="statusbar">
      {doc.kind === 'markdown' && (
        <span>
          {stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} characters
        </span>
      )}
      {authors.length > 0 && (
        <span title={authors.map((a) => `${a.kind === 'ai' ? 'AI' : a.kind === 'human' ? 'Human' : 'Reference'}: ${a.name}`).join('\n')}>
          Authorship: {authors.map((a) => a.name || (a.kind === 'ai' ? 'AI' : 'Human')).join(', ')}
          {doc.annotationStatus === 'invalid' ? ' (may be misplaced)' : ''}
        </span>
      )}
      <span className="status-spacer" />
      <span className={`save-state${dirty ? ' dirty' : ''}`}>{saving ? 'Saving…' : dirty ? 'Edited' : 'Saved'}</span>
    </div>
  );
}

function ImageView({ path }: { path: string }) {
  return (
    <div className="image-view">
      <img src={`mde-asset://local${path.split('/').map(encodeURIComponent).join('/')}`} alt={paths.basename(path)} />
    </div>
  );
}

function EmptyState() {
  const tree = useStore((s) => s.tree);
  const hasProjects = !!tree?.collections.some((c) => c.projects.length);
  return (
    <div className="empty-state">
      <h2>No document open</h2>
      <p>{hasProjects ? 'Choose a document in the library.' : 'Create a collection, then a project.'}</p>
      <p className="hint">⌘R toggles preview · ⇧⌘E exports PDF · ⌥⌘S creates a checkpoint</p>
    </div>
  );
}

export function Workspace() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const diff = useStore((s) => s.diff);
  const showPreview = mode === 'preview' && doc && (doc.kind === 'markdown' || doc.kind === 'css');
  return (
    <main className="workspace">
      <Toolbar />
      <div className="workspace-body">
        {!doc && <EmptyState />}
        {doc && (doc.kind === 'markdown' || doc.kind === 'css' || doc.kind === 'text') && (
          <div className={`pane${showPreview ? ' pane-hidden' : ''}`} aria-hidden={!!showPreview}>
            <Editor doc={doc} />
          </div>
        )}
        {doc?.kind === 'image' && <ImageView path={doc.path} />}
        {doc?.kind === 'unsupported' && (
          <div className="empty-state">
            <h2>{doc.name}</h2>
            <p>This file type cannot be edited here.</p>
            <button className="button" onClick={() => api.library.reveal(doc.path)}>
              Show in Finder
            </button>
          </div>
        )}
        {showPreview && (
          <div className="pane">
            <Preview />
          </div>
        )}
        {diff && <DiffView />}
      </div>
      <StatusBar />
    </main>
  );
}
