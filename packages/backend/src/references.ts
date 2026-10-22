// Reference files for the AI: listing, including, adding, and loading them for a request.

import { promises as fs } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import {
  IMAGE_MEDIA_TYPES,
  REFERENCES_DIR,
  docxText,
  estimateReferenceTokens,
  isHiddenName,
  referenceKind,
  type AiAttachment,
  type ReferenceInfo,
  type ReferenceKind,
} from '@mde/core';
import type { DocumentService } from './documents';
import { resolvesInside, uniqueName } from './fsutil';
import type { LibraryService } from './library';
import { UserError } from './library';
import { PdfPasswordError, pdfText } from './pdfText';

interface Extracted {
  mtimeMs: number;
  size: number;
  text: string;
  pages?: number;
  problem?: string;
}

/** Above these, PDFs go to Claude as extracted text instead of as files (request limit 32 MB, 600 pages). */
const NATIVE_PDF_BYTES = 20 * 1024 * 1024;
const NATIVE_PDF_PAGES = 500;

export class ReferenceService {
  private cache = new Map<string, Extracted>();

  constructor(
    private readonly library: LibraryService,
    private readonly documents: DocumentService,
  ) {}

  private rel(projectPath: string, path: string): string {
    return relative(projectPath, path).split(sep).join('/');
  }

  /** Text of a reference file (cached by modification time and size). */
  private async extract(path: string, kind: ReferenceKind): Promise<Extracted> {
    const st = await fs.stat(path);
    const hit = this.cache.get(path);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    let entry: Extracted = { mtimeMs: st.mtimeMs, size: st.size, text: '' };
    try {
      if (kind === 'pdf') {
        const r = await pdfText(new Uint8Array(await fs.readFile(path)));
        entry = { ...entry, pages: r.pages, text: r.pageTexts.map((t, i) => `[Page ${i + 1}]\n${t}`).join('\n\n') };
      } else if (kind === 'docx') entry.text = docxText(new Uint8Array(await fs.readFile(path)));
      else if (kind === 'text') entry.text = await fs.readFile(path, 'utf8');
    } catch (e) {
      entry.problem = e instanceof PdfPasswordError ? e.message : `Could not read this file (${e instanceof Error ? e.message : String(e)}).`;
    }
    this.cache.set(path, entry);
    return entry;
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (isHiddenName(name)) continue;
      const p = join(dir, name);
      // lstat: symbolic links are skipped, as in the file list, so a link cannot bring in a file from outside the project.
      const st = await fs.lstat(p).catch(() => null);
      if (st?.isDirectory()) await this.walk(p, out);
      else if (st?.isFile() && referenceKind(p)) out.push(p);
    }
  }

  async list(projectPath: string): Promise<ReferenceInfo[]> {
    this.library.assertInside(projectPath);
    const meta = await this.library.readMeta(projectPath);
    const included = new Set(meta.references ?? []);
    const files: string[] = [];
    await this.walk(join(projectPath, REFERENCES_DIR), files);
    for (const rel of included) {
      const p = join(projectPath, rel);
      if (!files.includes(p) && (await resolvesInside(p, [projectPath]))) files.push(p);
    }
    const out: ReferenceInfo[] = [];
    for (const path of files) {
      const kind = referenceKind(path)!;
      const x = await this.extract(path, kind);
      const rel = this.rel(projectPath, path);
      out.push({ path, rel, kind, size: x.size, pages: x.pages, tokens: estimateReferenceTokens(kind, x.text.length, x.pages), included: included.has(rel), problem: x.problem });
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
  }

  async setIncluded(projectPath: string, path: string, include: boolean): Promise<void> {
    this.library.assertInside(projectPath);
    const abs = path.startsWith('/') ? path : join(projectPath, path);
    this.library.assertInside(abs);
    if (!referenceKind(abs)) throw new UserError('This kind of file cannot be used as a reference.');
    const rel = this.rel(projectPath, abs);
    await this.documents.modifyMeta(projectPath, (meta) => {
      const list = (meta.references ?? []).filter((r) => r !== rel);
      if (include) list.push(rel);
      return { references: list };
    });
  }

  async add(projectPath: string, sources: string[]): Promise<string[]> {
    this.library.assertInside(projectPath);
    const dir = join(projectPath, REFERENCES_DIR);
    await this.library.assertWritable(dir);
    await fs.mkdir(dir, { recursive: true });
    const added: string[] = [];
    for (const src of sources) {
      if (!referenceKind(src)) throw new UserError(`“${basename(src)}” is not a supported reference type (PDF, Word, text, CSV or image).`);
      const ext = extname(src);
      const dest = join(dir, await uniqueName(dir, basename(src, ext), ext));
      await fs.copyFile(src, dest);
      added.push(dest);
    }
    const rels = added.map((p) => this.rel(projectPath, p));
    await this.documents.modifyMeta(projectPath, (meta) => ({ references: [...(meta.references ?? []).filter((r) => !rels.includes(r)), ...rels] }));
    return added;
  }

  /**
   * The included references, loaded for a request. PDFs carry their file data unless they are
   * too large together, in which case only their text is sent.
   */
  async attachments(projectPath: string): Promise<AiAttachment[]> {
    this.library.assertInside(projectPath);
    const meta = await this.library.readMeta(projectPath);
    const out: AiAttachment[] = [];
    for (const rel of meta.references ?? []) {
      const path = join(projectPath, rel);
      const kind = referenceKind(path);
      // project.json is data: a listed file is used only when it is in the project.
      if (!kind || !(await resolvesInside(path, [projectPath]))) continue;
      const x = await this.extract(path, kind);
      if (x.problem) continue;
      if (kind === 'image') out.push({ name: rel, kind, mediaType: IMAGE_MEDIA_TYPES[extname(path).toLowerCase()], data: (await fs.readFile(path)).toString('base64') });
      else if (kind === 'pdf') out.push({ name: rel, kind, text: x.text, pages: x.pages, mediaType: 'application/pdf', data: (await fs.readFile(path)).toString('base64') });
      else if (x.text.trim()) out.push({ name: rel, kind, text: x.text });
    }
    const pdfs = out.filter((a) => a.kind === 'pdf');
    const bytes = pdfs.reduce((s, a) => s + (a.data?.length ?? 0) * 0.75, 0);
    const pages = pdfs.reduce((s, a) => s + (a.pages ?? 0), 0);
    if (bytes > NATIVE_PDF_BYTES || pages > NATIVE_PDF_PAGES) for (const a of pdfs) delete a.data;
    return out;
  }
}
