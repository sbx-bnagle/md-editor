import { useEffect, useRef, useState, type FormEvent } from 'react';
import { closeDialog } from '../state/actions';
import { useStore, type DialogField } from '../state/store';

export function Dialog() {
  const spec = useStore((s) => s.dialog);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!spec) return;
    setValues(Object.fromEntries(spec.fields.map((f) => [f.name, f.value])));
    setError(null);
    setBusy(false);
    setTimeout(() => {
      firstInput.current?.focus();
      firstInput.current?.select();
    }, 0);
  }, [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && spec && closeDialog();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec]);

  if (!spec) return null;

  const visible = (f: DialogField) => !f.showIf || values[f.showIf.field] === f.showIf.equals;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    for (const f of spec.fields) if (f.type === 'text' && visible(f) && !String(values[f.name] ?? '').trim() && f.name === 'name') return setError('Enter a name.');
    setBusy(true);
    const err = await spec.onSubmit(values);
    setBusy(false);
    if (err) setError(err);
    else if (useStore.getState().dialog === spec) closeDialog();
  };
  let firstAssigned = false;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{spec.title}</h2>
        {spec.message && <p className="modal-message">{spec.message}</p>}
        {spec.fields.filter(visible).map((f) => {
          const set = (v: string | boolean) => setValues((s) => ({ ...s, [f.name]: v }));
          if (f.type === 'checkbox') {
            return (
              <label key={f.name} className="checkbox-row">
                <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(e.target.checked)} />
                {f.label}
              </label>
            );
          }
          if (f.type === 'radio') {
            return (
              <fieldset key={f.name} className="field">
                <legend>{f.label}</legend>
                <div className="radio-group">
                  {f.options?.map((o) => (
                    <label key={o.value} className={`radio-row${o.disabled ? ' disabled' : ''}`}>
                      <input type="radio" name={f.name} value={o.value} disabled={o.disabled} checked={values[f.name] === o.value} onChange={() => set(o.value)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          if (f.type === 'select') {
            return (
              <label key={f.name} className="field">
                <span>{f.label}</span>
                <select value={String(values[f.name] ?? '')} onChange={(e) => set(e.target.value)}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value} disabled={o.disabled}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          const ref = !firstAssigned ? ((firstAssigned = true), firstInput) : undefined;
          return (
            <label key={f.name} className="field">
              <span>{f.label}</span>
              <input ref={ref} type="text" value={String(values[f.name] ?? '')} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} spellCheck={false} autoComplete="off" />
              {f.help && <small>{f.help}</small>}
            </label>
          );
        })}
        {error && <div className="modal-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button" onClick={closeDialog}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {spec.okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
