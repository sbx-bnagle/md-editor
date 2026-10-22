import { promises as fs, createWriteStream } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { Zip, ZipDeflate } from 'fflate';
import { AI_LOG_FILE, CHAT_FILE, HISTORY_FILE, META_DIR, isHistoryConflictCopy, parsePageSpec, paths, type ExportPdfRequest, type ExportZipRequest } from '@mde/core';
import { atomicWrite, resolvesInside } from './fsutil';
import { PDFDocument } from 'pdf-lib';
import { makeAccessible } from './pdfAccessibility';
import { addPdfParts, applyPdfInserts, pdfInfo, sourceLoader, type PdfPart } from './pdfInserts';
import { UserError } from './library';
import { pathFromAssetUrl } from './assets';
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

const DATA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/**
 * Screen layout for the single-page web export: one centred column instead of pages. Running
 * headers and footers (page-wide components) belong to pages, so they are left out.
 */
const WEB_CSS = `
@media screen {
  html { background: #fff; }
  body { max-width: 46em; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
}
.mde-page-include, .mde-vars { display: none !important; }
.mde-pdf-insert { display: block; }
.mde-pdf-page { height: auto !important; margin: 1.5em 0; break-before: auto; break-after: auto; }
.mde-pdf-page img { display: block; width: 100%; height: auto; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25); }
`;

/**
 * The exported page runs no scripts, as in the preview: raw HTML in a document is shown, not run.
 * Images and fonts are embedded (data:); online images still load.
 */
const WEB_CSP = "default-src 'none'; img-src data: https:; media-src data: https:; font-src data:; style-src 'unsafe-inline'";

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class ExportService {
  constructor(
    private readonly library: LibraryService,
    private readonly render: RenderService,
    private readonly history: HistoryService,
    private readonly documents: DocumentService,
    private readonly host: HostAdapter,
    /** Roots local files may be embedded from (the library and the app's own resources). */
    private readonly assetRoots: () => string[] = () => [],
  ) {}

  /** Replaces local asset URLs with data URIs (images, fonts); links to local files keep only their name. */
  private async embedAssets(text: string): Promise<string> {
    const urls = [...new Set(text.match(/mde-asset:\/\/local[^"')\s<>]+/g) ?? [])];
    const data = new Map<string, string>();
    for (const url of urls) {
      const path = pathFromAssetUrl(url.replace(/&amp;/g, '&'));
      const type = path ? DATA_TYPES[extname(path).toLowerCase()] : undefined;
      if (!path || !type || !this.assetRoots().some((r) => path === r || path.startsWith(r + sep)) || !(await resolvesInside(path, this.assetRoots()))) continue;
      const bytes = await fs.readFile(path).catch(() => null);
      if (bytes) data.set(url, `data:${type};base64,${bytes.toString('base64')}`);
    }
    return text
      .replace(/(\shref=")(mde-asset:\/\/local[^"]+)"/g, (_m, pre: string, url: string) => `${pre}${escapeText(basename(pathFromAssetUrl(url.replace(/&amp;/g, '&')) ?? ''))}"`)
      .replace(/mde-asset:\/\/local[^"')\s<>]+/g, (url) => data.get(url) ?? url);
  }

  /** One self-contained .html file: the document in a single column with the theme's styles. */
  async html(req: { docPath: string; outPath?: string }): Promise<{ path: string } | null> {
    this.library.assertInside(req.docPath);
    const result = await this.render.render({ docPath: req.docPath });
    const defaultName = `${(result.variables.title || basename(req.docPath, extname(req.docPath))).replace(/[/:]/g, '-')}.html`;
    const out =
      req.outPath ??
      (await this.host.chooseSavePath({ title: 'Export Web Page', defaultPath: join(homedir(), 'Desktop', defaultName), extensions: ['html'] }));
    if (!out) return null;
    const lang = result.variables.lang || 'en';
    const body = (await this.host.renderWebPage({ html: result.html, css: result.css, title: result.title, lang })).replace(/\s(?:data-src-line|data-ref)="[^"]*"/g, '');
    const page = `<!doctype html>
<html lang="${escapeText(lang)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${WEB_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MD Editor">
<title>${escapeText(result.title)}</title>
<style>
${result.css.replace(/<\/(style)/gi, '<\\/$1')}
${WEB_CSS}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
    await fs.mkdir(dirname(out), { recursive: true });
    await atomicWrite(out, await this.embedAssets(page));
    return { path: out };
  }

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
      const inserts = [];
      for (const i of printed.inserts) {
        // The layout reports pages marked in the HTML, which a document can also write by hand: only files in the project are used.
        const path = join(root, i.file);
        if (!paths.isInside(path, root) || !(await resolvesInside(path, [root]))) throw new UserError(`“${i.file}” is outside the project folder, so its pages were not inserted.`);
        inserts.push({ index: i.index, path, page: i.page, alt: i.alt });
      }
      await applyPdfInserts(doc, inserts, load);
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
      const st = (await resolvesInside(path, [projectPath])) ? await fs.stat(path).catch(() => null) : null;
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
      // The Assistant conversation and the log of accepted AI text (with its prompts) are the writer's own, not part of the project handed over.
      if (rel === `${META_DIR}/${CHAT_FILE}` || rel === `${META_DIR}/${AI_LOG_FILE}`) continue;
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
