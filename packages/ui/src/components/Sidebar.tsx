import { useState, type MouseEvent, type ReactNode } from 'react';
import { isMarkdownFile, paths, type ContextMenuItem, type FileEntry, type ProjectRef, type ThemeInfo } from '@mde/core';
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
  newTemplateDialog,
  newThemeDialog,
  openFile,
  renameDialog,
  reportError,
  toggleExpanded,
  trashPath,
} from '../state/actions';
import { Chevron, FolderFilledIcon, FolderIcon, PlusIcon } from './icons';

async function menu(items: ContextMenuItem[], handlers: Record<string, () => void>) {
  try {
    const id = await api.ui.showContextMenu(items);
    if (id && handlers[id]) handlers[id]();
  } catch (e) {
    reportError(e);
  }
}

const sep: ContextMenuItem = { type: 'separator' };

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
      style={{ paddingLeft: 8 + depth * 14 }}
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
  const isTemplate = project.kind === 'template';
  const items: ContextMenuItem[] = [
    { id: 'file', label: 'New File…' },
    { id: 'folder', label: 'New Folder…' },
    sep,
    ...(isTemplate
      ? [{ id: 'use', label: 'New Project from Template…' }]
      : [
          { id: 'pdf', label: 'Export PDF…' },
          { id: 'zip', label: 'Export ZIP…' },
          { id: 'history', label: 'Show History' },
          sep,
          { id: 'template', label: 'Save as Template…' },
        ]),
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
            use: () => newProjectDialog(undefined, project.name),
            pdf: () => exportPdfDialog({ projectPath: project.path }).catch(reportError),
            zip: () => exportZipDialog(project.path),
            history: () => setState({ historyOpen: true, selected: project.path }),
            template: () => newTemplateDialog(project.path),
            rename: () => renameDialog(project.path),
            reveal: () => api.library.reveal(project.path),
            trash: () => trashPath(project.path),
          })
        }
      />
      {open && details && <FileTree entries={details.files} depth={depth + 1} projectPath={project.path} />}
      {open && details && details.files.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 8 + (depth + 1) * 14 + 16 }}>
          Empty
        </div>
      )}
    </div>
  );
}

function ThemeNode({ theme }: { theme: ThemeInfo }) {
  const docPath = useStore((s) => s.doc?.path);
  return (
    <Row
      depth={0}
      label={theme.name}
      active={docPath === theme.cssPath}
      onClick={() => openFile(theme.cssPath)}
      onContextMenu={() =>
        menu(
          [
            { id: 'edit', label: 'Edit CSS' },
            { id: 'dup', label: 'Duplicate…' },
            sep,
            { id: 'rename', label: 'Rename…' },
            { id: 'reveal', label: 'Show in Finder' },
            sep,
            { id: 'trash', label: 'Move to Trash' },
          ],
          {
            edit: () => openFile(theme.cssPath),
            dup: () => newThemeDialog(theme.name),
            rename: () => renameDialog(theme.path),
            reveal: () => api.library.reveal(theme.path),
            trash: () => trashPath(theme.path),
          },
        )
      }
    />
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
                { id: 'collection', label: 'New Collection…' },
                { id: 'template', label: 'New Template…' },
                { id: 'theme', label: 'New Theme…' },
                sep,
                { id: 'library', label: 'Open Another Library…' },
              ],
              {
                project: () => newProjectDialog(),
                collection: newCollectionDialog,
                template: () => newTemplateDialog(),
                theme: () => newThemeDialog(),
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
                      sep,
                      { id: 'rename', label: 'Rename…' },
                      { id: 'reveal', label: 'Show in Finder' },
                      sep,
                      { id: 'trash', label: 'Move to Trash' },
                    ],
                    {
                      project: () => newProjectDialog(c.name),
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
                    <div className="tree-empty" style={{ paddingLeft: 38 }}>
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
        <Section title="Templates" onAdd={() => newTemplateDialog()} addLabel="New Template">
          {tree.templates.length === 0 && <div className="tree-empty">No templates.</div>}
          {tree.templates.map((t) => (
            <ProjectNode key={t.path} project={t} depth={0} />
          ))}
        </Section>
        <Section title="Themes" onAdd={() => newThemeDialog()} addLabel="New Theme">
          {tree.themes.map((t) => (
            <ThemeNode key={t.path} theme={t} />
          ))}
        </Section>
      </div>
      <div className="sidebar-footer" title={tree.root}>
        {paths.basename(tree.root)}
      </div>
    </aside>
  );
}
