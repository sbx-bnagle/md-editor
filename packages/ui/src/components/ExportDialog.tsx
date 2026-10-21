import { useEffect, useState } from 'react';
import { formatPageSpec, parsePageSpec, paths, type ExportPart, type ProjectPdf } from '@mde/core';
import { api } from '../api/host';
import { reportError, runPdfExport } from '../state/actions';
import { setState, useStore } from '../state/store';

/** Folder that PDFs chosen from outside the project are copied into. */
const INSERTS_DIR = 'Inserts';
const DOCUMENT: ExportPart = { kind: 'document' };

function close() {
  setState({ exportDialog: null });
}

function pagesLabel(part: Extract<ExportPart, { kind: 'pdf' }>, pdf: ProjectPdf | undefined): string {
  if (!pdf?.pages) return part.pages ? `pages ${part.pages}` : 'all pages';
  const sel = parsePageSpec(part.pages, pdf.pages);
  if (sel.error) return sel.error;
  if (!part.pages) return `all ${pdf.pages} page${pdf.pages === 1 ? '' : 's'}`;
  return `${sel.pages.length === 1 ? 'page' : 'pages'} ${part.pages.replace(/-/g, '–').replace(/,/g, ', ')} of ${pdf.pages}`;
}

/** Export PDF: the document, with PDFs placed before and after it (saved per document). */
export function ExportDialog() {
  const spec = useStore((s) => s.exportDialog);
  const [docPath, setDocPath] = useState('');
  const [parts, setParts] = useState<ExportPart[]>([DOCUMENT]);
  const [saved, setSaved] = useState<Record<string, ExportPart[]>>({});
  const [pdfs, setPdfs] = useState<ProjectPdf[]>([]);
  const [busy, setBusy] = useState(false);

  const project = spec?.projectPath ?? '';
  const rel = (p: string) => paths.relative(project, p);

  useEffect(() => {
    if (!spec) return;
    setDocPath(spec.docPath);
    setBusy(false);
    Promise.all([api.project.details(spec.projectPath), api.project.pdfs(spec.projectPath)])
      .then(([details, list]) => {
        const arrangements = details.meta.exportArrangements ?? {};
        setSaved(arrangements);
        setParts(arrangements[paths.relative(spec.projectPath, spec.docPath)] ?? [DOCUMENT]);
        setPdfs(list);
      })
      .catch(reportError);
  }, [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && spec && !useStore.getState().pagePicker && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec]);

  if (!spec) return null;

  const pdfFor = (path: string) => pdfs.find((p) => p.rel === path);
  const update = (i: number, patch: Partial<Extract<ExportPart, { kind: 'pdf' }>>) => setParts((ps) => ps.map((p, j) => (j === i && p.kind === 'pdf' ? { ...p, ...patch } : p)));
  const move = (i: number, to: number) =>
    setParts((ps) => {
      if (to < 0 || to >= ps.length) return ps;
      const next = [...ps];
      const [p] = next.splice(i, 1);
      next.splice(to, 0, p);
      return next;
    });
  const remove = (i: number) => setParts((ps) => ps.filter((_, j) => j !== i));
  const addPdf = (path: string) => setParts((ps) => [...ps, { kind: 'pdf', path, title: paths.basename(path, '.pdf') }]);

  const chooseFile = async () => {
    try {
      const files = await api.app.chooseFiles('Choose PDFs to add to the export', ['pdf']);
      if (!files.length) return;
      const copied = await api.project.importFiles(project, files, INSERTS_DIR);
      setPdfs(await api.project.pdfs(project));
      setParts((ps) => [...ps, ...copied.map((p): ExportPart => ({ kind: 'pdf', path: rel(p), title: paths.basename(p, '.pdf') }))]);
    } catch (e) {
      reportError(e);
    }
  };

  const choosePages = (i: number, part: Extract<ExportPart, { kind: 'pdf' }>) => {
    const pdf = pdfFor(part.path);
    if (!pdf?.pages) return;
    const count = pdf.pages;
    setState({
      pagePicker: {
        name: part.title || paths.basename(part.path),
        url: pdf.url,
        count,
        pages: part.pages ? parsePageSpec(part.pages, count).pages : [],
        onDone: (pages) => update(i, { pages: formatPageSpec(pages, count) || undefined }),
      },
    });
  };

  const switchDocument = (path: string) => {
    setDocPath(path);
    setParts(saved[rel(path)] ?? [DOCUMENT]);
  };

  const problems = (): string[] => {
    const out: string[] = [];
    for (const p of parts) {
      if (p.kind !== 'pdf') continue;
      const pdf = pdfFor(p.path);
      if (!pdf) out.push(`“${p.path}” was not found in the project.`);
      else if (pdf.error) out.push(`“${p.path}”: ${pdf.error}`);
      else {
        if (!p.title?.trim()) out.push(`“${p.path}” has no description for screen readers; the export is not marked PDF/UA.`);
        if (pdf.unembeddedFonts) out.push(`“${p.path}” uses fonts that are not embedded in it; the export is not marked PDF/UA.`);
      }
    }
    return out;
  };

  const exportNow = async () => {
    setBusy(true);
    const arrangement = parts.some((p) => p.kind === 'pdf') ? parts : undefined;
    try {
      const next = { ...saved };
      if (arrangement) next[rel(docPath)] = arrangement;
      else delete next[rel(docPath)];
      await api.project.updateMeta(project, { exportArrangements: Object.keys(next).length ? next : undefined });
    } catch (e) {
      reportError(e);
    }
    const extra = problems();
    close();
    await runPdfExport(docPath, arrangement ?? [], extra);
  };

  const available = pdfs.filter((p) => !p.error);
  const docIndex = parts.findIndex((p) => p.kind === 'document');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">Export PDF</h2>
        <label className="field">
          <span>Document</span>
          <select value={docPath} onChange={(e) => switchDocument(e.target.value)}>
            {spec.documents.map((d) => (
              <option key={d} value={d}>
                {rel(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="arrange">
          <h3 className="picker-heading">Contents, in order</h3>
          <p className="modal-message">Add PDFs before or after the document, such as a cover letter or signed forms. They are exported page for page, as they are. The arrangement is saved for this document.</p>
          <ol className="arrange-list">
            {parts.map((part, i) => {
              const where = part.kind === 'document' ? '' : docIndex === -1 || i < docIndex ? 'Before' : 'After';
              const pdf = part.kind === 'pdf' ? pdfFor(part.path) : undefined;
              const problem = part.kind === 'pdf' ? (!pdf ? 'Not found in the project.' : pdf.error) : undefined;
              return (
                <li key={i} className={`arrange-row${part.kind === 'document' ? ' document' : ''}`}>
                  <div className="arrange-main">
                    {part.kind === 'document' ? (
                      <span className="arrange-name">
                        {paths.basename(docPath)} <span className="arrange-detail">the document</span>
                      </span>
                    ) : (
                      <>
                        <span className="arrange-name">
                          <span className="arrange-where">{where}</span> {part.path}{' '}
                          <span className={`arrange-detail${problem ? ' problem' : ''}`}>{problem ?? pagesLabel(part, pdf)}</span>
                        </span>
                        <input
                          type="text"
                          className="arrange-title"
                          value={part.title ?? ''}
                          placeholder="Description for screen readers"
                          aria-label={`Description of ${part.path}`}
                          onChange={(e) => update(i, { title: e.target.value })}
                          spellCheck={false}
                        />
                      </>
                    )}
                  </div>
                  <div className="arrange-actions">
                    {part.kind === 'pdf' && (
                      <button type="button" className="button small" onClick={() => choosePages(i, part)} disabled={!pdf?.pages}>
                        Pages…
                      </button>
                    )}
                    <button type="button" className="icon-button small" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${part.kind === 'document' ? 'the document' : part.path} up`}>
                      ↑
                    </button>
                    <button type="button" className="icon-button small" onClick={() => move(i, i + 1)} disabled={i === parts.length - 1} aria-label={`Move ${part.kind === 'document' ? 'the document' : part.path} down`}>
                      ↓
                    </button>
                    {part.kind === 'pdf' && (
                      <button type="button" className="icon-button small" onClick={() => remove(i)} aria-label={`Remove ${part.path}`}>
                        ×
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="arrange-add">
            <select
              value=""
              aria-label="Add a PDF from the project"
              onChange={(e) => {
                if (e.target.value) addPdf(e.target.value);
              }}
            >
              <option value="">{available.length ? 'Add a PDF from the project…' : 'No PDFs in the project'}</option>
              {available.map((p) => (
                <option key={p.rel} value={p.rel}>
                  {p.rel} ({p.pages} page{p.pages === 1 ? '' : 's'})
                </option>
              ))}
            </select>
            <button type="button" className="button small" onClick={chooseFile}>
              Add a file…
            </button>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={busy || !docPath} onClick={exportNow}>
            Export…
          </button>
        </div>
      </div>
    </div>
  );
}
