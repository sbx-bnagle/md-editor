import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  flattenVariables,
  includeTag,
  initialValues,
  listVariables,
  missingRequired,
  paths,
  splitFrontMatter,
  type ComponentParam,
  type ComponentSpec,
  type FileEntry,
  type IncludeFieldValue,
} from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { getState, setState, useStore } from '../state/store';

function close() {
  setState({ componentDialog: null });
}

const MAX_FILES = 500;

/** Project files as paths relative to the document's folder, for file fields. */
async function projectFiles(docPath: string): Promise<string[]> {
  const projectPath = getState().doc?.projectPath;
  if (!projectPath) return [];
  const details = await api.project.details(projectPath).catch(() => null);
  const out: string[] = [];
  const walk = (entries: FileEntry[]) => {
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.type === 'dir') walk(e.children ?? []);
      else out.push(paths.relative(paths.dirname(docPath), e.path));
    }
  };
  walk(details?.files ?? []);
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** The document's front matter variables, lists first (for variable fields). */
function documentVariables(): Array<{ name: string; list: boolean }> {
  const data = splitFrontMatter(editorBridge.getText() ?? '').data;
  const lists = Object.keys(listVariables(data));
  const others = Object.keys(flattenVariables(data)).filter((n) => !lists.includes(n));
  return [...lists.map((name) => ({ name, list: true })), ...others.map((name) => ({ name, list: false }))];
}

/**
 * Inserts a theme component: choose one, fill in its fields (described by the component, or read
 * from its template), and the include tag goes into the document. Also changes an existing tag.
 */
export function ComponentDialog() {
  const spec = useStore((s) => s.componentDialog);
  const [specs, setSpecs] = useState<ComponentSpec[] | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, IncludeFieldValue>>({});
  const [placement, setPlacement] = useState<'line' | 'inline'>('line');
  const [files, setFiles] = useState<string[]>([]);
  const [variables, setVariables] = useState<Array<{ name: string; list: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spec) return;
    setSpecs(null);
    setLoadError(null);
    setError(null);
    setPlacement(spec.emptyLine ? 'line' : 'inline');
    setVariables(documentVariables());
    projectFiles(spec.docPath).then(setFiles, () => setFiles([]));
    api.render
      .components({ docPath: spec.docPath, text: editorBridge.getText() ?? undefined })
      .then((r) => {
        setSpecs(r.components);
        setTheme(r.theme);
        const insertable = r.components.filter((c) => !c.page || c.name === spec.editing?.name);
        const first = spec.editing?.name ?? insertable[0]?.name ?? '';
        setName(first);
        const chosen = r.components.find((c) => c.name === first);
        setValues(chosen ? initialValues(chosen, spec.editing?.values) : {});
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && spec && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec]);

  const chosen = specs?.find((c) => c.name === name) ?? null;
  const editingKnown = !!spec?.editing && spec.editing.name === name;
  // Parameters the tag has that the component does not describe stay as they were.
  const extra = useMemo(() => {
    if (!spec?.editing || !chosen || spec.editing.name !== chosen.name) return {};
    return Object.fromEntries(Object.entries(spec.editing.values).filter(([k]) => !chosen.params.some((p) => p.name === k)));
  }, [spec, chosen]);
  const tag = chosen ? includeTag(chosen, values, extra) : '';

  if (!spec) return null;
  const insertable = (specs ?? []).filter((c) => !c.page || c.name === spec.editing?.name);
  const choose = (n: string) => {
    setName(n);
    setError(null);
    const c = specs?.find((x) => x.name === n);
    setValues(c ? initialValues(c, spec.editing?.name === n ? spec.editing.values : undefined) : {});
  };
  const set = (p: ComponentParam, v: IncludeFieldValue) => setValues((s) => ({ ...s, [p.name]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    const missing = missingRequired(chosen, values);
    if (missing.length) return setError(`Fill in ${missing.map((m) => `“${m}”`).join(', ')}.`);
    spec.onDone(tag, placement);
    close();
  };

  const field = (p: ComponentParam) => {
    const id = `component-field-${p.name}`;
    const v = values[p.name];
    const defaultText = typeof p.default === 'string' && p.default ? p.default : undefined;
    const label = (
      <span>
        {p.label}
        {p.required && <span className="required" aria-hidden="true"> *</span>}
      </span>
    );
    const help = (p.help || p.inferred) && (
      <small id={`${id}-help`}>
        {p.help}
        {p.inferred && !p.help && (p.type === 'variable' ? 'A front matter variable (it is passed as a list or value).' : 'Read from the component’s template.')}
      </small>
    );
    if (p.type === 'boolean') {
      return (
        <label key={p.name} className="checkbox-row component-field">
          <input type="checkbox" checked={v === true} onChange={(e) => set(p, e.target.checked)} />
          {p.label}
          {p.help && <small> {p.help}</small>}
        </label>
      );
    }
    if (p.type === 'choice') {
      return (
        <label key={p.name} className="field component-field">
          {label}
          <select value={String(v ?? '')} onChange={(e) => set(p, e.target.value)} aria-describedby={help ? `${id}-help` : undefined} required={p.required}>
            {!p.required && <option value="">{defaultText ? `Default (${defaultText})` : 'Not set'}</option>}
            {p.required && !v && <option value="">Choose…</option>}
            {p.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {help}
        </label>
      );
    }
    if (p.type === 'textarea') {
      return (
        <label key={p.name} className="field component-field">
          {label}
          <textarea rows={3} value={String(v ?? '')} placeholder={p.placeholder ?? (defaultText ? `Default: ${defaultText}` : undefined)} onChange={(e) => set(p, e.target.value)} aria-describedby={help ? `${id}-help` : undefined} spellCheck />
          {help}
        </label>
      );
    }
    const listId = p.type === 'file' || p.type === 'variable' ? `${id}-options` : undefined;
    const options =
      p.type === 'file'
        ? files.filter((f) => !p.accept?.length || p.accept.includes(paths.extname(f).slice(1)))
        : p.type === 'variable'
          ? variables.map((x) => x.name)
          : [];
    const placeholder = p.placeholder ?? (p.type === 'variable' ? (variables.find((x) => x.list)?.name ?? 'variable name') : defaultText ? `Default: ${defaultText}` : undefined);
    return (
      <label key={p.name} className="field component-field">
        {label}
        <input type="text" list={listId} value={String(v ?? '')} placeholder={placeholder} onChange={(e) => set(p, e.target.value)} aria-describedby={help ? `${id}-help` : undefined} spellCheck={false} autoComplete="off" />
        {listId && (
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
        {help}
      </label>
    );
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="modal component-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="component-dialog-title">
        <h2 id="component-dialog-title">{spec.editing ? 'Edit Component' : 'Insert Component'}</h2>
        <p className="modal-message">
          {spec.editing
            ? 'Change the fields; the include tag is updated in place.'
            : `Choose a component${theme ? ` of the theme “${theme}”` : ''} and fill in its fields. Fields left empty are left out of the tag, and the component uses its own default.`}
        </p>
        {loadError && (
          <div className="modal-error" role="alert">
            Could not read the components: {loadError}
          </div>
        )}
        {!specs && !loadError && <p className="modal-message">Reading the theme’s components…</p>}
        {specs && !insertable.length && <p className="modal-message">The theme has no components to insert. Add HTML files to its includes folder (see the themes guide).</p>}
        {specs && insertable.length > 0 && (
          <>
            <label className="field">
              <span>Component</span>
              <select value={name} onChange={(e) => choose(e.target.value)} disabled={!!spec.editing && editingKnown}>
                {!chosen && <option value={name}>{name} (not found)</option>}
                {insertable.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label} ({c.name})
                  </option>
                ))}
              </select>
            </label>
            {chosen?.description && <p className="component-description">{chosen.description}</p>}
            {chosen?.problem && <p className="component-problem">{chosen.problem}</p>}
            {chosen && !chosen.params.length && <p className="modal-message">This component has no fields.</p>}
            {chosen && chosen.params.length > 0 && <div className="component-fields">{chosen.params.map(field)}</div>}
            {!spec.editing && (
              <fieldset className="field">
                <legend>Place it</legend>
                <div className="radio-group">
                  <label className="radio-row">
                    <input type="radio" name="component-placement" checked={placement === 'line'} onChange={() => setPlacement('line')} />
                    On a line of its own (a block)
                  </label>
                  <label className="radio-row">
                    <input type="radio" name="component-placement" checked={placement === 'inline'} onChange={() => setPlacement('inline')} />
                    In the text at the cursor (inline)
                  </label>
                </div>
              </fieldset>
            )}
            {chosen && (
              <div className="field">
                <span>{spec.editing ? 'Updated tag' : 'Inserted text'}</span>
                <code className="component-preview">{tag}</code>
              </div>
            )}
          </>
        )}
        {error && (
          <div className="modal-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!chosen}>
            {spec.editing ? 'Update' : 'Insert'}
          </button>
        </div>
      </form>
    </div>
  );
}
