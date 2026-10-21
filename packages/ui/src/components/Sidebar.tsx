import { useState, type MouseEvent, type ReactNode } from 'react';
import { LIBRARY_DIRS, isMarkdownFile, paths, type ContextMenuItem, type FileEntry, type ProjectRef } from '@mde/core';
import { api } from '../api/host';
import { useStore, setState } from '../state/store';
import {
  chooseLibraryDialog,
  exportPdfDialog,
  exportZipDialog,
  newCollectionDialog,
  newFileDialog,
  newFolderDialog,
  newProjectDialog,
  newProjectFromTemplateDialog,
  newTemplateDialog,
  openFile,
  renameDialog,
  reportError,
  toggleExpanded,
  trashPath,
} from '../state/actions';
import { Chevron, FolderFilledIcon, FolderIcon, PlusIcon } from './icons';
import { nativeMenu as menu, separator as sep } from './popover';

/** Indent per tree level, in pixels. */
const INDENT = 18;
const indent = (depth: number) => 8 + depth * INDENT;

// Icons mark only projects (filled folder) and folders inside projects (outlined folder).
interface RowProps {
  depth: number;
  icon?: ReactNode;
  className?: string;
  label: string;
  expandable?: boolean;
  expanded?: boolean;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
  onToggle?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  title?: string;
}

function Row({ depth, icon, className, label, expandable, expanded, active, muted, onClick, onToggle, onContextMenu, title }: RowProps) {
  return (
    <div
      className={`tree-row${active ? ' active' : ''}${muted ? ' muted' : ''}${className ? ` ${className}` : ''}`}
      style={{ paddingLeft: indent(depth) }}
      onClick={() => (onClick ?? onToggle)?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e);
      }}
      title={title ?? label}
      role="treeitem"
      aria-expanded={expandable ? !!expanded : undefined}
      aria-selected={active}
    >
      <span
        className={`tree-chevron${expandable ? '' : ' hidden'}${expanded ? ' open' : ''}`}
        onClick={(e) => {
          if (!expandable) return;
          e.stopPropagation();
          onToggle?.();
        }}
      >
        <Chevron size={12} />
      </span>
      {icon && <span className="tree-icon">{icon}</span>}
      <span className="tree-label">{label}</span>
    </div>
  );
}

function FileTree({ entries, depth, projectPath }: { entries: FileEntry[]; depth: number; projectPath: string }) {
  const expanded = useStore((s) => s.expanded);
  const docPath = useStore((s) => s.doc?.path);
  return (
    <>
      {entries.map((e) => {
        if (e.type === 'dir') {
          const open = !!expanded[e.path];
          return (
            <div key={e.path}>
              <Row
                depth={depth}
                className="compact"
                icon={<FolderIcon />}
                label={e.name}
                expandable
                expanded={open}
                onToggle={() => toggleExpanded(e.path, false)}
                onContextMenu={() =>
                  menu(
                    [
                      { id: 'file', label: 'New File…' },
                      { id: 'folder', label: 'New Folder…' },
                      sep,
                      { id: 'rename', label: 'Rename…' },
                      { id: 'reveal', label: 'Show in Finder' },
                      sep,
                      { id: 'trash', label: 'Move to Trash' },
                    ],
                    {
                      file: () => newFileDialog(e.path),
                      folder: () => newFolderDialog(e.path),
                      rename: () => renameDialog(e.path),
                      reveal: () => api.library.reveal(e.path),
                      trash: () => trashPath(e.path),
                    },
                  )
                }
              />
              {open && <FileTree entries={e.children ?? []} depth={depth + 1} projectPath={projectPath} />}
            </div>
          );
        }
        const md = isMarkdownFile(e.path);
        return (
          <Row
            key={e.path}
            depth={depth}
            className="compact"
            label={e.name}
            muted={!md}
            active={docPath === e.path}
            onClick={() => openFile(e.path)}
            onContextMenu={() =>
              menu(
                [
                  ...(md ? [{ id: 'pdf', label: 'Export PDF…' }, sep] : []),
                  { id: 'rename', label: 'Rename…' },
                  { id: 'reveal', label: 'Show in Finder' },
                  sep,
                  { id: 'trash', label: 'Move to Trash' },
                ],
                {
                  pdf: () => exportPdfDialog({ docPath: e.path }),
                  rename: () => renameDialog(e.path),
                  reveal: () => api.library.reveal(e.path),
                  trash: () => trashPath(e.path),
                },
              )
            }
          />
        );
      })}
    </>
  );
}

function ProjectNode({ project, depth }: { project: ProjectRef; depth: number }) {
  const open = useStore((s) => !!s.expanded[project.path]);
  const details = useStore((s) => s.projects[project.path]);
  const items: ContextMenuItem[] = [
    { id: 'file', label: 'New File…' },
    { id: 'folder', label: 'New Folder…' },
    sep,
    { id: 'pdf', label: 'Export PDF…' },
    { id: 'zip', label: 'Export ZIP…' },
    { id: 'history', label: 'Show History' },
    sep,
    { id: 'template', label: 'New Template from Project…' },
    sep,
    { id: 'rename', label: 'Rename…' },
    { id: 'reveal', label: 'Show in Finder' },
    sep,
    { id: 'trash', label: 'Move to Trash' },
  ];
  return (
    <div>
      <Row
        depth={depth}
        icon={<FolderFilledIcon />}
        className="project"
        label={project.name}
        expandable
        expanded={open}
        onToggle={() => toggleExpanded(project.path, true)}
        onClick={() => {
          setState({ selected: project.path });
          toggleExpanded(project.path, true);
        }}
        onContextMenu={() =>
          menu(items, {
            file: () => newFileDialog(project.path),
            folder: () => newFolderDialog(project.path),
            pdf: () => exportPdfDialog({ projectPath: project.path }).catch(reportError),
            zip: () => exportZipDialog(project.path),
            history: () => setState({ panel: 'history', selected: project.path }),
            template: () => newTemplateDialog(project.path),
            rename: () => renameDialog(project.path),
            reveal: () => api.library.reveal(project.path),
            trash: () => trashPath(project.path),
          })
        }
      />
      {open && details && <FileTree entries={details.files} depth={depth + 1} projectPath={project.path} />}
      {open && details && details.files.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: indent(depth + 1) + 18 }}>
          Empty
        </div>
      )}
    </div>
  );
}

function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="sidebar-section">
      <header>
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`tree-chevron${open ? ' open' : ''}`}>
            <Chevron size={10} />
          </span>
          {title}
        </button>
        {onAdd && (
          <button className="icon-button small" onClick={onAdd} title={addLabel} aria-label={addLabel}>
            <PlusIcon size={13} />
          </button>
        )}
      </header>
      {open && <div role="tree">{children}</div>}
    </section>
  );
}

export function Sidebar() {
  const tree = useStore((s) => s.tree);
  const expanded = useStore((s) => s.expanded);
  if (!tree) return <aside className="sidebar" />;
  return (
    <aside className="sidebar">
      <div className="sidebar-titlebar drag">
        <span className="sidebar-title">Library</span>
        <button
          className="icon-button no-drag"
          title="New…"
          aria-label="New"
          onClick={() =>
            menu(
              [
                { id: 'project', label: 'New Project…' },
                { id: 'from-template', label: 'New Project from Template…', enabled: tree.templates.length > 0 },
                { id: 'collection', label: 'New Collection…' },
                sep,
                { id: 'template', label: 'New Template from Project…' },
                { id: 'templates', label: 'Show Templates in Finder' },
                sep,
                { id: 'settings', label: 'Settings…' },
                { id: 'library', label: 'Open Another Library…' },
              ],
              {
                project: () => newProjectDialog(),
                'from-template': () => newProjectFromTemplateDialog(),
                collection: newCollectionDialog,
                template: () => newTemplateDialog(),
                templates: () => api.library.reveal(paths.join(tree.root, LIBRARY_DIRS.templates)).catch(reportError),
                settings: () => setState({ settingsOpen: true }),
                library: chooseLibraryDialog,
              },
            )
          }
        >
          <PlusIcon />
        </button>
      </div>
      <div className="sidebar-scroll">
        <Section title="Collections" onAdd={newCollectionDialog} addLabel="New Collection">
          {tree.collections.length === 0 && <div className="tree-empty">No collections yet.</div>}
          {tree.collections.map((c) => (
            <div key={c.path}>
              <Row
                depth={0}
                label={c.name}
                expandable
                expanded={!!expanded[c.path]}
                onToggle={() => toggleExpanded(c.path, false)}
                onContextMenu={() =>
                  menu(
                    [
                      { id: 'project', label: 'New Project…' },
                      { id: 'from-template', label: 'New Project from Template…', enabled: tree.templates.length > 0 },
                      sep,
                      { id: 'rename', label: 'Rename…' },
                      { id: 'reveal', label: 'Show in Finder' },
                      sep,
                      { id: 'trash', label: 'Move to Trash' },
                    ],
                    {
                      project: () => newProjectDialog(c.name),
                      'from-template': () => newProjectFromTemplateDialog(c.name),
                      rename: () => renameDialog(c.path),
                      reveal: () => api.library.reveal(c.path),
                      trash: () => trashPath(c.path),
                    },
                  )
                }
              />
              {expanded[c.path] && (
                <>
                  {c.projects.map((p) => (
                    <ProjectNode key={p.path} project={p} depth={1} />
                  ))}
                  {c.projects.length === 0 && (
                    <div className="tree-empty" style={{ paddingLeft: indent(1) + 18 }}>
                      <button className="link-button" onClick={() => newProjectDialog(c.name)}>
                        New project…
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}
