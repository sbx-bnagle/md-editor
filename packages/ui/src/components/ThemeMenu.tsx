import { useCallback, useState } from 'react';
import { splitFrontMatter, type ThemeInfo } from '@mde/core';
import { FILES_APP, api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { addFontsToTheme, addImagesToTheme, customizeTheme, exportTheme, importTheme, newThemeDialog, openFile, renameDialog, requestRender, setProjectTheme, trashPath } from '../state/actions';
import { useStore } from '../state/store';
import { nativeMenu, separator, useOutsideClose } from './popover';

const NO_THEMES: ThemeInfo[] = [];

/** Bottom bar menu: choose the project or document theme, edit a theme, or create one. */
export function ThemeMenu() {
  const doc = useStore((s) => s.doc);
  const libraryThemes = useStore((s) => s.tree?.themes ?? NO_THEMES);
  const project = useStore((s) => (s.doc?.projectPath ? s.projects[s.doc.projectPath] : undefined));
  const render = useStore((s) => s.render);
  const [open, setOpen] = useState(false);
  const [docTheme, setDocTheme] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);

  const inProject = !!(doc && doc.kind === 'markdown' && doc.projectPath);
  const projectTheme = project?.meta.theme ?? 'Classic';
  const themes = project?.themes ?? [];
  const activeName = docTheme ?? projectTheme;
  const activeTheme = themes.find((t) => t.name === activeName);
  const label = inProject ? (docTheme ?? render?.themeName ?? projectTheme) : 'Themes';
  const projectCopies = themes.filter((t) => t.scope === 'project');

  const toggle = () => {
    if (!open && inProject) {
      const t = splitFrontMatter(editorBridge.getText() ?? '').data.theme;
      setDocTheme(typeof t === 'string' ? t : null);
    }
    setOpen(!open);
  };
  const setDoc = (name: string | null) => {
    editorBridge.setFrontMatterValue('theme', name);
    setDocTheme(name);
    if (useStore.getState().mode === 'preview') setTimeout(requestRender, 50);
  };
  const edit = (t: ThemeInfo) => {
    setOpen(false);
    openFile(t.cssPath);
  };
  const themeContextMenu = (t: ThemeInfo) =>
    nativeMenu(
      t.scope === 'library'
        ? [
            { id: 'edit', label: 'Edit CSS' },
            { id: 'dup', label: 'Duplicate…' },
            { id: 'fonts', label: 'Add Fonts…' },
            { id: 'images', label: 'Add Images…' },
            { id: 'export', label: 'Export…' },
            separator,
            { id: 'rename', label: 'Rename…' },
            { id: 'reveal', label: `Show in ${FILES_APP}` },
            separator,
            { id: 'trash', label: 'Move to Trash' },
          ]
        : [
            { id: 'edit', label: 'Edit CSS' },
            { id: 'reveal', label: `Show in ${FILES_APP}` },
            separator,
            { id: 'trash', label: 'Remove Project Copy' },
          ],
      {
        edit: () => edit(t),
        dup: () => (setOpen(false), newThemeDialog(t.name)),
        fonts: () => (setOpen(false), addFontsToTheme(t.name)),
        images: () => (setOpen(false), addImagesToTheme(t.name)),
        export: () => (setOpen(false), exportTheme(t.name)),
        rename: () => (setOpen(false), renameDialog(t.path)),
        reveal: () => api.library.reveal(t.path),
        trash: () => (setOpen(false), trashPath(t.path)),
      },
    );

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="status-button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title="Theme">
        {inProject ? `Theme: ${label}` : label}
      </button>
      {open && (
        <div className="popover up theme-popover" role="menu">
          {inProject && doc?.projectPath && (
            <>
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
            </>
          )}
          <div className="popover-heading">Edit theme</div>
          {libraryThemes.map((t) => (
            <button key={`e-${t.path}`} className="popover-item" onClick={() => edit(t)} onContextMenu={(e) => (e.preventDefault(), themeContextMenu(t))} title="Edit the library theme (right-click for more)">
              {t.name}
            </button>
          ))}
          {projectCopies.map((t) => (
            <button key={`c-${t.path}`} className="popover-item" onClick={() => edit(t)} onContextMenu={(e) => (e.preventDefault(), themeContextMenu(t))} title="Edit this project’s copy (right-click for more)">
              {t.name}
              <span className="badge">this project</span>
            </button>
          ))}
          <div className="popover-separator" />
          {inProject && activeTheme?.scope === 'library' && (
            <button className="popover-item" onClick={() => (setOpen(false), customizeTheme(doc!.projectPath!, activeTheme.name))}>
              Customize “{activeTheme.name}” for this project
            </button>
          )}
          <button className="popover-item" onClick={() => (setOpen(false), newThemeDialog())}>
            New theme…
          </button>
          <button className="popover-item" onClick={() => (setOpen(false), importTheme())}>
            Import theme…
          </button>
        </div>
      )}
    </div>
  );
}
