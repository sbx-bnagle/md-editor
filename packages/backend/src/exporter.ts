import { promises as fs, createWriteStream } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { Zip, ZipDeflate } from 'fflate';
import { HISTORY_FILE, META_DIR, type ExportPdfRequest, type ExportZipRequest } from '@mde/core';
import { atomicWrite } from './fsutil';
import { makeAccessiblePdf } from './pdfAccessibility';
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
    const printed = await this.host.renderPdf({ html: result.html, css: result.css, title: result.title, lang });
    let pdf = printed;
    try {
      // Claim PDF/UA only when the pre-export check found nothing that would break it.
      const claimPdfUa = !result.warnings.some((w) => w.kind === 'accessibility');
      pdf = (await makeAccessiblePdf(printed, { title: result.title, lang, creator: 'MD Editor', claimPdfUa })).bytes;
    } catch (e) {
      console.error('PDF accessibility pass failed; writing the PDF as printed.', e);
    }
    await atomicWrite(out, pdf);
    if (projectPath) {
      await this.documents.updateMeta(projectPath, { lastExport: relative(projectPath, req.docPath).split(sep).join('/') });
      await this.history.snapshot(projectPath, 'export', `Exported ${basename(out)}`, true);
    }
    return { path: out };
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
      if (!req.includeHistory && rel === `${META_DIR}/${HISTORY_FILE}`) continue;
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
