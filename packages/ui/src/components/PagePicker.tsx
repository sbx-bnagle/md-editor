import { useEffect, useState, type DragEvent } from 'react';
import { renderPageImage } from '../preview/pdfPages';
import { setState, useStore } from '../state/store';

const THUMB_WIDTH = 120;
const thumbs = new Map<string, Promise<string>>();

function thumb(url: string, n: number): Promise<string> {
  const key = `${url}#${n}`;
  let t = thumbs.get(key);
  if (!t) {
    t = renderPageImage(url, n, THUMB_WIDTH);
    thumbs.set(key, t);
    t.catch(() => thumbs.delete(key));
  }
  return t;
}

function close() {
  setState({ pagePicker: null });
}

/** Chooses which pages of a PDF to include and in what order. */
export function PagePicker() {
  const spec = useStore((s) => s.pagePicker);
  const [selected, setSelected] = useState<number[]>([]);
  const [images, setImages] = useState<Record<number, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  useEffect(() => {
    if (!spec) return;
    setSelected(spec.pages.length ? spec.pages : Array.from({ length: spec.count }, (_, i) => i + 1));
    setImages({});
    setFailed(null);
    let cancelled = false;
    // One page at a time keeps memory flat for long files.
    (async () => {
      for (let n = 1; n <= spec.count && !cancelled; n++) {
        try {
          const src = await thumb(spec.url, n);
          if (!cancelled) setImages((m) => ({ ...m, [n]: src }));
        } catch (e) {
          if (!cancelled) setFailed(e instanceof Error ? e.message : String(e));
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && spec && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec]);

  if (!spec) return null;
  const all = Array.from({ length: spec.count }, (_, i) => i + 1);
  const toggle = (n: number) => setSelected((s) => (s.includes(n) ? s.filter((p) => p !== n) : [...s, n]));
  const move = (from: number, to: number) =>
    setSelected((s) => {
      if (to < 0 || to >= s.length) return s;
      const next = [...s];
      const [p] = next.splice(from, 1);
      next.splice(to, 0, p);
      return next;
    });
  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (dragFrom !== null) move(dragFrom, to);
    setDragFrom(null);
  };
  const image = (n: number, className: string) =>
    images[n] ? <img className={className} src={images[n]} alt="" draggable={false} /> : <span className={`${className} placeholder`} aria-hidden="true" />;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide page-picker" role="dialog" aria-modal="true" aria-labelledby="page-picker-title">
        <h2 id="page-picker-title">Pages of “{spec.name}”</h2>
        <p className="modal-message">Click pages to include or leave them out. Drag included pages, or use their arrows, to change the order.</p>
        {failed && <div className="modal-error" role="alert">Could not draw the pages: {failed}</div>}
        <h3 className="picker-heading">
          Included, in order <span>{selected.length} of {spec.count}</span>
        </h3>
        {selected.length === 0 ? (
          <p className="picker-empty">No pages. Click pages below to include them.</p>
        ) : (
          <ol className="picker-strip">
            {selected.map((n, i) => (
              <li
                key={n}
                className={`picker-item${dragFrom === i ? ' dragging' : ''}`}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, i)}
              >
                {image(n, 'picker-thumb small')}
                <span className="picker-label">p. {n}</span>
                <span className="picker-actions">
                  <button type="button" className="icon-button small" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move page ${n} earlier`}>
                    ‹
                  </button>
                  <button type="button" className="icon-button small" onClick={() => move(i, i + 1)} disabled={i === selected.length - 1} aria-label={`Move page ${n} later`}>
                    ›
                  </button>
                  <button type="button" className="icon-button small" onClick={() => toggle(n)} aria-label={`Leave out page ${n}`}>
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <h3 className="picker-heading">All pages</h3>
        <div className="picker-grid">
          {all.map((n) => {
            const at = selected.indexOf(n);
            return (
              <button key={n} type="button" className={`picker-page${at >= 0 ? ' on' : ''}`} aria-pressed={at >= 0} onClick={() => toggle(n)} title={at >= 0 ? `Included as number ${at + 1}` : 'Not included'}>
                {image(n, 'picker-thumb')}
                <span className="picker-label">Page {n}</span>
                {at >= 0 && <span className="picker-badge">{at + 1}</span>}
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" className="link-button" onClick={() => setSelected(all)}>
            Include all in order
          </button>
          <button type="button" className="link-button" onClick={() => setSelected([])}>
            Clear
          </button>
          <span className="spacer" />
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={selected.length === 0}
            onClick={() => {
              spec.onDone(selected);
              close();
            }}
          >
            Use {selected.length} page{selected.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
