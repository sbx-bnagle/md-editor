import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { APP_MENUS, paths, type ComposeWarning, type ContextMenuItem, type SyncState, type TabGroupColor } from '@mde/core';
import { FILES_APP, api, assetUrl, isWeb } from '../api/host';
import {
  addTabToGroup,
  addTabToNewGroup,
  closeTab,
  closeTabGroup,
  dropGroup,
  dropTab,
  editTabGroup,
  newFileDialog,
  newTabInGroup,
  removeTabFromGroup,
  reportError,
  runCommand,
  setMode,
  stepTabOver,
  switchTab,
  toggleTabGroup,
  ungroupTabs,
  zoomBy,
} from '../state/actions';
import type { DropOver } from '../state/tabOrder';
import { getState, setState, useStore, type DocTab, type OpenDoc, type TabGroup } from '../state/store';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { DocIcon, LibraryIcon, MenuIcon, MoreIcon, WarningIcon } from './icons';
import { DiffView } from './DiffView';
import { CommandBar } from './CommandBar';
import { PanelTabs, RightPanel } from './RightPanel';
import { GuidesMenu } from './Guides';
import { ThemeMenu } from './ThemeMenu';
import { nativeMenu, separator, useOutsideClose } from './popover';
import { refineVoice } from '../ai/actions';

function WarningsButton() {
  const render = useStore((s) => s.render);
  const mode = useStore((s) => s.mode);
  const open = useStore((s) => s.warningsOpen);
  const close = useCallback(() => setState({ warningsOpen: false }), []);
  const ref = useOutsideClose(open, close);
  // Accessibility problems are listed in Insights › Accessibility instead.
  const warnings = render?.warnings.filter((w) => w.kind !== 'accessibility') ?? [];
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

/** Web app: the app's menus (the Mac app's menu bar), the side panels and the storage, in one menu. */
function appMenuItems(): { items: ContextMenuItem[]; run: Record<string, () => void> } {
  const run: Record<string, () => void> = {};
  const items: ContextMenuItem[] = [];
  for (const section of APP_MENUS) {
    const sub: ContextMenuItem[] = [];
    for (const entry of section.items) {
      if ('separator' in entry) {
        if (sub.length && sub[sub.length - 1].type !== 'separator') sub.push({ type: 'separator' });
      } else if ('command' in entry) {
        const id = `cmd:${entry.command}`;
        run[id] = () => runCommand(entry.command);
        sub.push({ id, label: entry.label, ...(entry.checked ? { checked: !!getState().prefs?.[entry.checked] } : {}) });
      } else if (entry.role === 'undo' || entry.role === 'redo') {
        const id = `role:${entry.role}`;
        run[id] = () => document.execCommand(entry.role!);
        sub.push({ id, label: entry.role === 'undo' ? 'Undo' : 'Redo' });
      } else if (entry.role === 'cut' || entry.role === 'copy' || entry.role === 'paste' || entry.role === 'selectAll') {
        sub.push({ label: { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All' }[entry.role], role: entry.role });
      }
    }
    while (sub.length && sub[sub.length - 1].type === 'separator') sub.pop();
    if (sub.length) items.push({ label: section.role === 'appMenu' ? 'Folio Dome' : section.label, submenu: sub });
  }
  items.push({ type: 'separator' });
  for (const [id, label] of [['assistant', 'Assistant'], ['insights', 'Insights'], ['history', 'History']] as const) {
    run[`panel:${id}`] = () => setState((s) => ({ panel: s.panel === id ? null : id }));
    items.push({ id: `panel:${id}`, label, checked: getState().panel === id });
  }
  items.push({ type: 'separator' });
  run.storage = () => void api.sync?.showStorage();
  items.push({ id: 'storage', label: `Storage (${FILES_APP})…` });
  return { items, run };
}

function WebButtons() {
  const drawerOpen = useStore((s) => s.drawerOpen);
  const hasLibrary = useStore((s) => !!s.app?.libraryPath);
  const doc = useStore((s) => s.doc);
  return (
    <>
      {hasLibrary && (
        <button className="icon-button web-library-button" onClick={() => setState({ drawerOpen: !drawerOpen })} aria-expanded={drawerOpen} aria-label="Library" title="Library">
          <LibraryIcon />
        </button>
      )}
      <button
        className="icon-button web-menu-button"
        aria-label="Menu"
        title="Menu"
        onClick={() => {
          const { items, run } = appMenuItems();
          nativeMenu(items, run);
        }}
      >
        <MenuIcon />
      </button>
      {doc && doc.kind !== 'image' && doc.kind !== 'unsupported' && (
        <button className="icon-button web-editor-menu" aria-label="Editor menu" title="Editor menu (insert, thesaurus, components)" onClick={() => (window as { __folioEditorMenu?: () => void }).__folioEditorMenu?.()}>
          <MoreIcon />
        </button>
      )}
    </>
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
        {isWeb && <WebButtons />}
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

/** Group label and line colours (dark text on the label). */
const GROUP_COLORS: Record<TabGroupColor, string> = {
  grey: '#a8adb5',
  blue: '#7fb0ff',
  red: '#f28b82',
  yellow: '#f5d36b',
  green: '#81c995',
  pink: '#ff8bcb',
  purple: '#c58af9',
  cyan: '#78d9ec',
  orange: '#fcad70',
};

/** What is being dragged in the tab bar (a drag's data cannot be read until the drop). */
let dragging: { kind: 'tab' | 'group'; id: number } | null = null;

type DropMark = { key: string; after: boolean } | null;

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const groups = useStore((s) => s.tabGroups);
  const active = useStore((s) => s.activeTab);
  const labels = tabLabels(tabs);
  const [mark, setMark] = useState<DropMark>(null);
  const over = useRef<DropOver | null>(null);
  const groupOf = (id?: number) => (id === undefined ? undefined : groups.find((g) => g.id === id));

  const point = (e: React.DragEvent, target: { kind: 'tab' | 'group'; id: number }): DropOver => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    return target.kind === 'tab' ? { kind: 'tab', id: target.id, after } : { kind: 'group', id: target.id, after, collapsed: !!groupOf(target.id)?.collapsed };
  };
  const dragOver = (target: { kind: 'tab' | 'group'; id: number }) => (e: React.DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    over.current = point(e, target);
    const key = `${target.kind}:${target.id}`;
    const after = over.current.kind !== 'end' && over.current.after;
    if (mark?.key !== key || mark.after !== after) setMark({ key, after });
  };
  const barOver = (e: React.DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    // Past the last tab: the end of the bar. In the gaps between tabs, the last place stays.
    const items = (e.currentTarget as HTMLElement).querySelectorAll('.doc-tab, .tab-group-chip');
    const last = items[items.length - 1]?.getBoundingClientRect();
    if (!last || e.clientX > last.right) {
      over.current = { kind: 'end' };
      if (mark?.key !== 'end') setMark({ key: 'end', after: true });
    }
  };
  const drop = (e: React.DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const d = dragging;
    const where = over.current;
    dragging = null;
    over.current = null;
    setMark(null);
    if (!where) return;
    if (d.kind === 'tab') dropTab(d.id, where);
    else dropGroup(d.id, where);
  };
  const dragStart = (kind: 'tab' | 'group', id: number) => (e: React.DragEvent) => {
    dragging = { kind, id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-folio-tab', String(id));
  };
  const dragEnd = () => {
    dragging = null;
    over.current = null;
    setMark(null);
  };
  const markClass = (key: string) => (mark?.key === key ? (mark.after ? ' drop-after' : ' drop-before') : '');

  const tabMenu = (t: DocTab, i: number) => {
    const others = groups.filter((g) => g.id !== t.group);
    const run: Record<string, () => void> = {
      'new-group': () => addTabToNewGroup(t.id),
      'leave-group': () => removeTabFromGroup(t.id),
      left: () => stepTabOver(t.id, -1),
      right: () => stepTabOver(t.id, 1),
      close: () => void closeTab(t.id).catch(reportError),
    };
    for (const g of others) run[`group:${g.id}`] = () => addTabToGroup(t.id, g.id);
    const items: ContextMenuItem[] = [
      { id: 'new-group', label: 'Add Tab to New Group' },
      ...(others.length ? [{ label: 'Add Tab to Group', submenu: others.map((g) => ({ id: `group:${g.id}`, label: g.name || 'Unnamed group', color: GROUP_COLORS[g.color] })) }] : []),
      ...(t.group !== undefined ? [{ id: 'leave-group', label: 'Remove from Group' }] : []),
      separator,
      { id: 'left', label: 'Move Tab Left', enabled: i > 0 || t.group !== undefined },
      { id: 'right', label: 'Move Tab Right', enabled: i < tabs.length - 1 || t.group !== undefined },
      separator,
      { id: 'close', label: 'Close Tab' },
    ];
    nativeMenu(items, run);
  };
  const groupMenu = (g: TabGroup) =>
    nativeMenu(
      [
        { id: 'edit', label: 'Name and Colour…' },
        { id: 'new-tab', label: 'New Tab in Group' },
        { id: 'toggle', label: g.collapsed ? 'Expand Group' : 'Collapse Group' },
        separator,
        { id: 'ungroup', label: 'Ungroup' },
        { id: 'close', label: 'Close Group' },
      ],
      {
        edit: () => editTabGroup(g.id),
        'new-tab': () => void newTabInGroup(g.id).catch(reportError),
        toggle: () => void toggleTabGroup(g.id).catch(reportError),
        ungroup: () => ungroupTabs(g.id),
        close: () => void closeTabGroup(g.id).catch(reportError),
      },
    );

  const items: ReactNode[] = [];
  tabs.forEach((t, i) => {
    const g = groupOf(t.group);
    if (g && tabs[i - 1]?.group !== g.id) {
      const count = tabs.filter((x) => x.group === g.id).length;
      const name = g.name || 'Unnamed group';
      items.push(
        <button
          key={`group-${g.id}`}
          className={`tab-group-chip${g.collapsed ? ' collapsed' : ''}${g.name ? '' : ' unnamed'}${markClass(`group:${g.id}`)}`}
          style={{ '--group': GROUP_COLORS[g.color] } as CSSProperties}
          draggable
          onDragStart={dragStart('group', g.id)}
          onDragEnd={dragEnd}
          onDragOver={dragOver({ kind: 'group', id: g.id })}
          onClick={() => toggleTabGroup(g.id).catch(reportError)}
          onContextMenu={(e) => {
            e.preventDefault();
            groupMenu(g);
          }}
          aria-expanded={!g.collapsed}
          aria-label={`Tab group ${name}, ${count} tab${count === 1 ? '' : 's'}`}
          title={`${name}: ${g.collapsed ? 'expand' : 'collapse'} (right-click for more)`}
        >
          {g.name}
          {g.collapsed && <span className="tab-group-count">{count}</span>}
        </button>,
      );
    }
    if (g?.collapsed) return;
    items.push(
      <div
        key={t.id}
        className={`doc-tab${t.id === active ? ' active' : ''}${g ? ' grouped' : ''}${markClass(`tab:${t.id}`)}`}
        style={g ? ({ '--group': GROUP_COLORS[g.color] } as CSSProperties) : undefined}
        title={t.path ?? 'New Tab'}
        draggable
        onDragStart={dragStart('tab', t.id)}
        onDragEnd={dragEnd}
        onDragOver={dragOver({ kind: 'tab', id: t.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          tabMenu(t, i);
        }}
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
      </div>,
    );
  });
  return (
    <div className="tab-bar" role="tablist" aria-label="Open documents" onDragOver={barOver} onDrop={drop}>
      {items}
      <button className={`doc-tab-new${mark?.key === 'end' ? ' drop-before' : ''}`} aria-label="New File" title="New File (⌘N)" onClick={() => newFileDialog()}>
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

/** Web app: whether the library's changes have reached Dropbox or Google Drive. */
function SyncIndicator({ sync }: { sync: SyncState }) {
  const text =
    sync.state === 'synced'
      ? `Saved to ${sync.service}`
      : sync.state === 'syncing'
        ? `Saving to ${sync.service}…`
        : sync.state === 'offline'
          ? `Offline: ${sync.pending} change${sync.pending === 1 ? '' : 's'} kept on this device`
          : sync.state === 'signed-out'
            ? `Sign in to ${sync.service}`
            : `Not all changes reached ${sync.service}`;
  if (sync.state === 'signed-out') {
    return (
      <button className="status-button sync-state signed-out" onClick={() => api.sync?.signIn().catch(reportError)} title="Changes are kept on this device until you sign in">
        {text}
      </button>
    );
  }
  return (
    <span className={`sync-state ${sync.state}`} role="status" title={sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting` : text}>
      {text}
    </span>
  );
}

function StatusBar() {
  const sync = useStore((s) => s.sync);
  const doc = useStore((s) => s.doc);
  const tree = useStore((s) => s.tree);
  const stats = useStore((s) => s.stats);
  const textDoc = doc && (doc.kind === 'markdown' || doc.kind === 'css' || doc.kind === 'text') ? doc : null;
  const authors = textDoc?.annotations?.authors ?? [];
  const fileLabel = textDoc ? libraryFileLabel(textDoc, tree?.root) : null;
  return (
    <div className="statusbar">
      {fileLabel && <span className="status-file">{fileLabel}</span>}
      {textDoc?.kind === 'markdown' && (
        <span className="status-count">
          <span>{stats.words.toLocaleString()} words</span>
          <span className="status-chars">· {stats.chars.toLocaleString()} characters</span>
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
      {sync && <SyncIndicator sync={sync} />}
    </div>
  );
}

function ImageView({ path }: { path: string }) {
  return (
    <div className="image-view">
      <img src={assetUrl(path)} alt={paths.basename(path)} />
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
                Show in {FILES_APP}
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
