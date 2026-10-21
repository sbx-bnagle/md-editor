import { promises as fs, createWriteStream } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { Zip, ZipDeflate } from 'fflate';
import { HISTORY_FILE, META_DIR, isHistoryConflictCopy, parsePageSpec, type ExportPdfRequest, type ExportZipRequest } from '@mde/core';
import { atomicWrite } from './fsutil';
import { PDFDocument } from 'pdf-lib';
import { makeAccessible } from './pdfAccessibility';
import { addPdfParts, applyPdfInserts, pdfInfo, sourceLoader, type PdfPart } from './pdfInserts';
import { UserError } from './library';
import type { HostAdapter } from './host';
import type { LibraryService } from './library';
import type { RenderService } from './render';
import type { HistoryService } from './history';
import type { DocumentService } from './documents';

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

export class ExportService {
  constructor(
    private readonly library: LibraryService,
    private readonly render: RenderService,
    private readonly history: HistoryService,
    private readonly documents: DocumentService,
    private readonly host: HostAdapter,
  ) {}

  async pdf(req: ExportPdfRequest): Promise<{ path: string } | null> {
    this.library.assertInside(req.docPath);
    const projectPath = this.library.projectFor(req.docPath);
    const result = await this.render.render({ docPath: req.docPath });
    const defaultName = `${(result.variables.title || basename(req.docPath, extname(req.docPath))).replace(/[/:]/g, '-')}.pdf`;
    const out =
      req.outPath ??
      (await this.host.chooseSavePath({ title: 'Export PDF', defaultPath: join(homedir(), 'Desktop', defaultName), extensions: ['pdf'] }));
    if (!out) return null;
    const lang = result.variables.lang || 'en';
    const parts = projectPath ? await this.arrangementParts(projectPath, req) : [];
    const printed = await this.host.renderPdf({ html: result.html, css: result.css, title: result.title, lang });
    let pdf = printed.pdf;
    // Claim PDF/UA only when the pre-export check found nothing that would break it.
    const claimPdfUa = !result.warnings.some((w) => w.kind === 'accessibility') && parts.every((p) => p.titled);
    try {
      const doc = await PDFDocument.load(printed.pdf, { updateMetadata: false });
      const load = sourceLoader(async (p) => new Uint8Array(await fs.readFile(p)));
      const root = projectPath ?? dirname(req.docPath);
      await applyPdfInserts(doc, printed.inserts.map((i) => ({ index: i.index, path: join(root, i.file), page: i.page, alt: i.alt })), load);
      await addPdfParts(doc, parts, load);
      makeAccessible(doc, { title: result.title, lang, creator: 'MD Editor', claimPdfUa });
      pdf = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    } catch (e) {
      // Without inserted pages the printed PDF is complete, so it is still worth writing.
      if (printed.inserts.length || parts.length) throw new UserError(`Could not add the PDF pages: ${e instanceof Error ? e.message : String(e)}`);
      console.error('PDF accessibility pass failed; writing the PDF as printed.', e);
    }
    await atomicWrite(out, pdf);
    if (projectPath) {
      await this.documents.updateMeta(projectPath, { lastExport: relative(projectPath, req.docPath).split(sep).join('/') });
      await this.history.snapshot(projectPath, 'export', `Exported ${basename(out)}`, true);
    }
    return { path: out };
  }

  /** PDF parts placed before and after the document, from the request or the saved arrangement. */
  private async arrangementParts(projectPath: string, req: ExportPdfRequest): Promise<Array<PdfPart & { titled: boolean }>> {
    const rel = relative(projectPath, req.docPath).split(sep).join('/');
    const arrangement = req.arrangement ?? (await this.library.readMeta(projectPath)).exportArrangements?.[rel] ?? [];
    const docIndex = arrangement.findIndex((p) => p.kind === 'document');
    const out: Array<PdfPart & { titled: boolean }> = [];
    for (const [i, part] of arrangement.entries()) {
      if (part.kind !== 'pdf') continue;
      const path = join(projectPath, part.path);
      this.library.assertInside(path);
      const st = await fs.stat(path).catch(() => null);
      if (!st) throw new UserError(`“${part.path}” is in the export arrangement but was not found.`);
      const info = await pdfInfo(path, st, async () => new Uint8Array(await fs.readFile(path)));
      if ('error' in info) throw new UserError(`“${part.path}”: ${info.error}`);
      const pages = parsePageSpec(part.pages, info.pages);
      if (pages.error) throw new UserError(`“${part.path}” pages: ${pages.error}`);
      out.push({ position: docIndex !== -1 && i > docIndex ? 'after' : 'before', path, pages: pages.pages, title: part.title?.trim() || basename(part.path, '.pdf'), titled: !!part.title?.trim() && !info.unembeddedFonts });
    }
    return out;
  }

  async zip(req: ExportZipRequest): Promise<{ path: string } | null> {
    this.library.assertInside(req.projectPath);
    const name = basename(req.projectPath);
    const out =
      req.outPath ??
      (await this.host.chooseSavePath({ title: 'Export ZIP', defaultPath: join(homedir(), 'Desktop', `${name}.zip`), extensions: ['zip'] }));
    if (!out) return null;
    await this.history.flush();

    await fs.mkdir(dirname(out), { recursive: true });
    const tmp = `${out}.partial`;
    const stream = createWriteStream(tmp);
    const done = new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        stream.destroy(err);
        return;
      }
      stream.write(chunk);
      if (final) stream.end();
    });
    for await (const abs of walk(req.projectPath)) {
      const rel = relative(req.projectPath, abs).split(sep).join('/');
      const base = basename(abs);
      if (base === '.DS_Store' || base.endsWith('.tmp')) continue;
      if (!req.includeHistory && (rel === `${META_DIR}/${HISTORY_FILE}` || (rel.startsWith(`${META_DIR}/`) && isHistoryConflictCopy(basename(rel))))) continue;
      const entry = new ZipDeflate(`${name}/${rel}`, { level: 6 });
      zip.add(entry);
      entry.push(new Uint8Array(await fs.readFile(abs)), true);
    }
    zip.end();
    await done;
    await fs.rename(tmp, out);
    return { path: out };
  }
}
