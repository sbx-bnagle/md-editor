import { useCallback, useState } from 'react';
import { paths, type ComposeWarning } from '@mde/core';
import { api } from '../api/host';
import { closeTab, newFileDialog, setMode, switchTab, zoomBy } from '../state/actions';
import { setState, useStore, type DocTab, type OpenDoc } from '../state/store';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { DocIcon, WarningIcon } from './icons';
import { DiffView } from './DiffView';
import { CommandBar } from './CommandBar';
import { PanelTabs, RightPanel } from './RightPanel';
import { GuidesMenu } from './Guides';
import { ThemeMenu } from './ThemeMenu';
import { useOutsideClose } from './popover';
import { refineVoice } from '../ai/actions';
import { updatePrefs } from '../state/prefs';

function WarningsButton() {
  const render = useStore((s) => s.render);
  const mode = useStore((s) => s.mode);
  const open = useStore((s) => s.warningsOpen);
  const close = useCallback(() => setState({ warningsOpen: false }), []);
  const ref = useOutsideClose(open, close);
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

/** "3 / 12": the page at the top of the preview, editable to jump to a page. */
function PageIndicator() {
  const rendering = useStore((s) => s.rendering);
  const pageCount = useStore((s) => s.pageCount);
  const page = useStore((s) => s.previewPage);
  const [draft, setDraft] = useState<string | null>(null);
  if (rendering && !pageCount) return <span className="page-count">Laying out…</span>;
  if (!pageCount) return null;
  const go = () => {
    const n = Number(draft);
    setDraft(null);
    if (Number.isInteger(n) && n >= 1 && n <= pageCount)
      setState((s) => ({
        pageJump: { page: n, seq: (s.pageJump?.seq ?? 0) + 1 },
      }));
  };
  return (
    <span className={`page-count${rendering ? ' rendering' : ''}`} title={rendering ? 'Laying out…' : undefined}>
      <input
        className="page-input"
        aria-label={`Page, of ${pageCount}`}
        inputMode="numeric"
        value={draft ?? String(page ?? 1)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go();
          else if (e.key === 'Escape') setDraft(null);
        }}
        onBlur={go}
        size={Math.max(1, String(pageCount).length)}
      />
      <span className="page-total">/ {pageCount}</span>
    </span>
  );
}

function ZoomControls() {
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => (s.mode === 'edit' ? (s.prefs?.editorZoom ?? 1) : s.zoom));
  const what = mode === 'edit' ? 'text' : 'pages';
  return (
    <div className="zoom-controls">
      <button className="icon-button" onClick={() => zoomBy(-0.1)} title={`Zoom out (⌘−)`} aria-label={`Zoom out the ${what}`}>
        −
      </button>
      <button className="zoom-label" onClick={() => zoomBy(null)} title="Actual size (⌘0)" aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to actual size`}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-button" onClick={() => zoomBy(0.1)} title={`Zoom in (⌘+)`} aria-label={`Zoom in the ${what}`}>
        +
      </button>
    </div>
  );
}

function Toolbar() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const panel = useStore((s) => s.panel);
  const canPreview = doc && (doc.kind === 'markdown' || doc.kind === 'css');
  const canZoom = doc && (mode === 'preview' ? canPreview : doc.kind === 'markdown' || doc.kind === 'css' || doc.kind === 'text');
  return (
    <div className="toolbar drag">
      <div className="toolbar-left">
        {canPreview && (
          <div className="segmented view-toggle" role="tablist" aria-label="View">
            <button
              role="tab"
              aria-selected={mode === 'edit'}
              aria-label={doc?.kind === 'css' ? 'CSS' : 'Markdown'}
              className={mode === 'edit' ? 'on' : ''}
              onClick={() => setMode('edit')}
              title={`${doc?.kind === 'css' ? 'CSS' : 'Markdown'} (⌘R toggles)`}
            >
              <span className="view-glyph" aria-hidden="true">
                {doc?.kind === 'css' ? '{ }' : '#'}
              </span>
            </button>
            <button role="tab" aria-selected={mode === 'preview'} aria-label="Preview" className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')} title="Preview (⌘R toggles)">
              <DocIcon />
            </button>
          </div>
        )}
        {canZoom && <ZoomControls />}
        {mode === 'preview' && canPreview && <PageIndicator />}
        {mode === 'preview' && doc?.kind === 'markdown' && <span className="toolbar-hint">Double-click text to edit it</span>}
      </div>
      <div className="toolbar-actions no-drag">
        <WarningsButton />
        {doc?.kind === 'markdown' && doc.path.includes('/Guides/Voices/') && (
          <button className="toolbar-button" onClick={refineVoice} title="Propose changes to this voice guide from how AI drafts were edited">
            <span>Refine from edits…</span>
          </button>
        )}
        {/* While the side panel is open, these are its tabs, at the top of the panel. */}
        {!panel && <PanelTabs />}
      </div>
    </div>
  );
}

/** File names, with the folder added where two tabs show files of the same name. */
function tabLabels(tabs: DocTab[]): string[] {
  const names = tabs.map((t) => (t.path ? paths.basename(t.path) : 'New Tab'));
  return tabs.map((t, i) => (t.path && names.filter((n) => n === names[i]).length > 1 ? `${names[i]} — ${paths.basename(paths.dirname(t.path))}` : names[i]));
}

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const labels = tabLabels(tabs);
  return (
    <div className="tab-bar" role="tablist" aria-label="Open documents">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={`doc-tab${t.id === active ? ' active' : ''}`}
          title={t.path ?? 'New Tab'}
          onMouseDown={(e) => {
            // Middle-click closes, as in browsers.
            if (e.button === 1) {
              e.preventDefault();
              closeTab(t.id);
            }
          }}
        >
          <button className="doc-tab-name" role="tab" aria-selected={t.id === active} onClick={() => switchTab(t.id)}>
            {labels[i]}
          </button>
          <button className="doc-tab-close" aria-label={`Close ${labels[i]}`} title="Close Tab (⌘W)" onClick={() => closeTab(t.id)}>
            ×
          </button>
        </div>
      ))}
      <button className="doc-tab-new" aria-label="New File" title="New File (⌘N)" onClick={() => newFileDialog()}>
        +
      </button>
    </div>
  );
}

/** Names a file that lives outside the project tree (themes, guides), since the sidebar does not list them. */
function libraryFileLabel(doc: OpenDoc, root: string | undefined): string | null {
  if (doc.projectPath && !doc.path.includes('/.mdeditor/themes/')) return null;
  const rel = root ? paths.relative(root, doc.path) : doc.path;
  const parts = rel.split('/');
  if (doc.path.includes('/.mdeditor/themes/')) return `Project theme “${parts[parts.length - 2]}”`;
  if (parts[0] === 'Themes') return `Theme “${parts[1]}”`;
  if (parts[0] === 'Guides' && parts[1] === 'Voices') return `Voice guide “${paths.basename(rel).replace(/\.md$/i, '')}”`;
  if (parts[0] === 'Guides' && parts[1] === 'Styles') return `Style guide “${paths.basename(rel).replace(/\.md$/i, '')}”`;
  if (parts[0] === 'Templates') return `Template “${parts[1]}”`;
  return paths.basename(rel);
}

function StatusBar() {
  const doc = useStore((s) => s.doc);
  const tree = useStore((s) => s.tree);
  const stats = useStore((s) => s.stats);
  const dirty = useStore((s) => s.dirty);
  const saving = useStore((s) => s.saving);
  const prefs = useStore((s) => s.prefs);
  const textDoc = doc && (doc.kind === 'markdown' || doc.kind === 'css' || doc.kind === 'text') ? doc : null;
  const authors = textDoc?.annotations?.authors ?? [];
  const fileLabel = textDoc ? libraryFileLabel(textDoc, tree?.root) : null;
  return (
    <div className="statusbar">
      {fileLabel && <span className="status-file">{fileLabel}</span>}
      {textDoc?.kind === 'markdown' && (
        <span>
          {stats.words.toLocaleString()} words
          <span className="status-chars"> · {stats.chars.toLocaleString()} characters</span>
        </span>
      )}
      {authors.length > 0 && (
        <span title={authors.map((a) => `${a.kind === 'ai' ? 'AI' : a.kind === 'human' ? 'Human' : 'Reference'}: ${a.name}`).join('\n')}>
          Authorship: {authors.map((a) => a.name || (a.kind === 'ai' ? 'AI' : 'Human')).join(', ')}
          {textDoc?.annotationStatus === 'invalid' ? ' (may be misplaced)' : ''}
        </span>
      )}
      <span className="status-spacer" />
      {tree && <GuidesMenu />}
      {tree && <ThemeMenu />}
      {textDoc?.kind === 'markdown' && prefs && (
        <button className="status-button" onClick={() => updatePrefs({ showAuthorship: !prefs.showAuthorship })} title="Show or hide AI-written text (⇧⌘A)">
          AI text {prefs.showAuthorship ? 'shown' : 'hidden'}
        </button>
      )}
      {textDoc && (
        <span className={`save-state${dirty || saving ? ' dirty' : ''}`} role="status" aria-label={saving ? 'Saving' : dirty ? 'Not saved yet' : 'Saved'} title={saving ? 'Saving…' : dirty ? 'Not saved yet' : 'Saved'} />
      )}
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
  const panel = useStore((s) => s.panel);
  const showPreview = mode === 'preview' && doc && (doc.kind === 'markdown' || doc.kind === 'css');
  return (
    <main className="workspace">
      <div className="workspace-main">
        <Toolbar />
        <TabBar />
        <div className="workspace-body">
          {!doc && <EmptyState />}
          {doc && (doc.kind === 'markdown' || doc.kind === 'css' || doc.kind === 'text') && (
            <div className={`pane${showPreview ? ' pane-hidden' : ''}`} aria-hidden={!!showPreview}>
              <Editor doc={doc} />
              {!showPreview && <CommandBar />}
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
      </div>
      {panel && <RightPanel />}
    </main>
  );
}
