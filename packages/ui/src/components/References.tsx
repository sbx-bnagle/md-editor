import { useState } from 'react';
import { REFERENCES_DIR, paths, type ReferenceInfo } from '@mde/core';
import { api } from '../api/host';
import { addReferenceFiles, setReferenceIncluded } from '../ai/references';
import { useStore } from '../state/store';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTokens(n: number): string {
  return n < 1000 ? `${n}` : `${Math.round(n / 1000)}k`;
}

const KIND_LABEL: Record<ReferenceInfo['kind'], string> = { pdf: 'PDF', docx: 'Word', text: 'Text', image: 'Image' };

/** Reference files the AI reads with each request in this project (Assistant, Ask AI, Review). */
export function ReferencesSection() {
  const doc = useStore((s) => s.doc);
  const refs = useStore((s) => s.references);
  const [open, setOpen] = useState(true);
  if (!doc?.projectPath || refs.projectPath !== doc.projectPath) return null;
  const projectPath = doc.projectPath;
  const included = refs.items.filter((r) => r.included && !r.problem);
  const tokens = included.reduce((s, r) => s + r.tokens, 0);
  return (
    <section className="references">
      <header className="references-head">
        <button className="section-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          References
          <span className="references-summary">{included.length ? `${included.length} included · ≈${formatTokens(tokens)} tokens per request` : 'none included'}</span>
        </button>
        <button className="button small" onClick={() => addReferenceFiles(projectPath)}>
          Add files…
        </button>
      </header>
      {open && (
        <div className="references-list">
          {refs.items.length === 0 && (
            <p className="references-empty">
              Add an RFP, addenda, a brief or notes. The AI reads the files you tick with each request. They are copied into the project’s {REFERENCES_DIR} folder.
            </p>
          )}
          {refs.items.map((r) => (
            <label key={r.path} className={`reference-row${r.problem ? ' problem' : ''}`} title={r.problem ?? r.rel}>
              <input type="checkbox" checked={r.included} disabled={!!r.problem} onChange={(e) => setReferenceIncluded(r.path, e.target.checked)} />
              <span className="reference-name">{paths.basename(r.rel)}</span>
              <span className="reference-detail">
                {r.problem ?? [KIND_LABEL[r.kind], r.pages ? `${r.pages} page${r.pages === 1 ? '' : 's'}` : formatSize(r.size), `≈${formatTokens(r.tokens)} tokens`].join(' · ')}
              </span>
              <button
                className="icon-button small reference-reveal"
                onClick={(e) => {
                  e.preventDefault();
                  api.library.reveal(r.path);
                }}
                title="Show in Finder"
                aria-label={`Show ${paths.basename(r.rel)} in Finder`}
              >
                ↗
              </button>
            </label>
          ))}
          {tokens > 150_000 && <p className="references-note">These files are large. Claude reuses them between requests for a few minutes (prompt caching); other services read them in full every time.</p>}
        </div>
      )}
    </section>
  );
}
