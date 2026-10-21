// Pages from other PDFs in an export: in the document (content blocks such as /W-9.pdf, laid
// out as placeholder pages) and before or after it (the export arrangement).
//
// Each inserted page is copied whole (it keeps its own size), its form fields and other
// annotations are drawn into the page (flattened), the source file's tags are removed, and
// the page is tagged as one Figure with a description, so the export stays tagged.
import { PDFArray, PDFDict, PDFDocument, PDFNumber, PDFPage, PDFRef, PDFStream, PDFHexString, type PDFObject } from 'pdf-lib';
import { stripMarkedContent } from '@mde/core';
import {
  N,
  addParentEntry,
  concatBytes,
  documentElement,
  kidsOf,
  pageContent,
  removeParentEntry,
  replaceStream,
  streamBytes,
  structElements,
  structRoot,
} from './pdfUtil';

export type LoadSource = (path: string) => Promise<PDFDocument>;

/** Loads source PDFs once per export. Encrypted or damaged files throw. */
export function sourceLoader(read: (path: string) => Promise<Uint8Array>): LoadSource {
  const cache = new Map<string, Promise<PDFDocument>>();
  return (path) => {
    let p = cache.get(path);
    if (!p) {
      p = read(path).then((bytes) => PDFDocument.load(bytes, { updateMetadata: false }));
      cache.set(path, p);
    }
    return p;
  };
}

const num = (o: PDFObject | undefined, fallback = 0) => (o instanceof PDFNumber ? o.asNumber() : fallback);

/** Removes tags from form XObjects reachable from `resources` (tags refer to the source file's tree). */
function stripFormTags(doc: PDFDocument, resources: PDFDict | undefined, seen: Set<PDFRef>): void {
  const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
  if (!xobjects) return;
  for (const [, value] of xobjects.entries()) {
    if (!(value instanceof PDFRef) || seen.has(value)) continue;
    seen.add(value);
    const form = doc.context.lookup(value);
    if (!(form instanceof PDFStream) || form.dict.get(N('Subtype')) !== N('Form')) continue;
    form.dict.delete(N('StructParents'));
    form.dict.delete(N('StructParent'));
    const bytes = streamBytes(form);
    if (bytes) replaceStream(doc, value, stripMarkedContent(bytes));
    stripFormTags(doc, (doc.context.lookup(value) as PDFStream).dict.lookupMaybe(N('Resources'), PDFDict), seen);
  }
}

/** Draws visible annotations (filled form fields, stamps, comments) into the page and removes them. */
function flattenAnnotations(doc: PDFDocument, page: PDFPage): string {
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  if (!annots) return '';
  let resources = page.node.Resources();
  if (!resources) {
    resources = doc.context.obj({});
    page.node.set(N('Resources'), resources);
  }
  let xobjects = resources.lookupMaybe(N('XObject'), PDFDict);
  if (!xobjects) {
    xobjects = doc.context.obj({});
    resources.set(N('XObject'), xobjects);
  }
  const ops: string[] = [];
  annots.asArray().forEach((a, i) => {
    const annot = doc.context.lookup(a);
    if (!(annot instanceof PDFDict)) return;
    const flags = num(annot.get(N('F')));
    if (flags & 2 || flags & 32 || annot.get(N('Subtype')) === N('Popup')) return; // hidden, no-view
    const ap = annot.lookupMaybe(N('AP'), PDFDict);
    let normal: PDFObject | undefined = ap?.get(N('N'));
    const resolved = normal instanceof PDFRef ? doc.context.lookup(normal) : normal;
    if (resolved instanceof PDFDict && !(resolved instanceof PDFStream)) {
      const state = annot.get(N('AS'));
      normal = state ? resolved.get(state as ReturnType<typeof N>) : undefined;
    }
    const stream = normal instanceof PDFRef ? doc.context.lookup(normal) : normal;
    if (!(stream instanceof PDFStream)) return;
    const rect = annot.lookupMaybe(N('Rect'), PDFArray)?.asArray().map((v) => num(v));
    const bbox = stream.dict.lookupMaybe(N('BBox'), PDFArray)?.asArray().map((v) => num(v));
    if (!rect || rect.length < 4 || !bbox || bbox.length < 4) return;
    const m = stream.dict.lookupMaybe(N('Matrix'), PDFArray)?.asArray().map((v) => num(v)) ?? [1, 0, 0, 1, 0, 0];
    // PDF 32000-1, 12.5.5: transform the BBox by Matrix, then map that box onto Rect.
    const pts = [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[1]],
      [bbox[0], bbox[3]],
      [bbox[2], bbox[3]],
    ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const bx1 = Math.min(...pts.map((p) => p[0]));
    const by1 = Math.min(...pts.map((p) => p[1]));
    const bx2 = Math.max(...pts.map((p) => p[0]));
    const by2 = Math.max(...pts.map((p) => p[1]));
    const [rx1, ry1, rx2, ry2] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
    if (bx2 - bx1 <= 0 || by2 - by1 <= 0) return;
    const sx = (rx2 - rx1) / (bx2 - bx1);
    const sy = (ry2 - ry1) / (by2 - by1);
    const ref = normal instanceof PDFRef ? normal : doc.context.register(stream);
    const name = `MdeFlat${i}`;
    xobjects!.set(N(name), ref);
    const f = (n: number) => Number(n.toFixed(4));
    ops.push(`q ${f(sx)} 0 0 ${f(sy)} ${f(rx1 - bx1 * sx)} ${f(ry1 - by1 * sy)} cm /${name} Do Q`);
  });
  page.node.delete(N('Annots'));
  return ops.join('\n');
}

/** Copies one page of `src` into `doc` (not yet placed in the page tree), tagged as a Figure whose element is `figureRef`. */
async function copyTagged(doc: PDFDocument, src: PDFDocument, pageNumber: number, figureRef: PDFRef): Promise<PDFPage> {
  const [page] = await doc.copyPages(src, [pageNumber - 1]);
  const annotationOps = flattenAnnotations(doc, page);
  stripFormTags(doc, page.node.Resources(), new Set());
  const content = stripMarkedContent(pageContent(doc, page.node));
  const enc = new TextEncoder();
  const body = concatBytes([enc.encode('/Figure <</MCID 0>> BDC\nq'), content, enc.encode(`Q\n${annotationOps}\nEMC`)]);
  page.node.set(N('Contents'), doc.context.register(doc.context.flateStream(body)));
  page.node.delete(N('StructParents'));
  page.node.delete(N('Tabs'));
  const root = structRoot(doc)!;
  page.node.set(N('StructParents'), PDFNumber.of(addParentEntry(doc, root, doc.context.obj([figureRef]))));
  return page;
}

function setFigureContent(doc: PDFDocument, figure: PDFDict, page: PDFPage, alt: string): void {
  figure.set(N('K'), PDFNumber.of(0));
  figure.set(N('Pg'), page.ref);
  if (!figure.get(N('Alt'))) figure.set(N('Alt'), PDFHexString.fromText(alt));
}

export interface InsertPlacement {
  /** 0-based index of the placeholder page in the printed PDF. */
  index: number;
  path: string;
  page: number;
  alt: string;
}

/** Replaces placeholder pages with the pages they stand for. */
export async function applyPdfInserts(doc: PDFDocument, inserts: InsertPlacement[], load: LoadSource): Promise<void> {
  if (!inserts.length) return;
  documentElement(doc);
  const root = structRoot(doc)!;
  for (const ins of [...inserts].sort((a, b) => b.index - a.index)) {
    const placeholder = doc.getPage(ins.index);
    const placeholderRef = placeholder.ref;
    // Chromium tags the placeholder (role="img") as a Figure on that page; reuse it so the
    // inserted page keeps its place in the reading order.
    const onPage = structElements(doc).filter(({ el }) => el.get(N('Pg')) === placeholderRef);
    let figure = onPage.find(({ el }) => el.get(N('S')) === N('Figure'));
    if (!figure?.ref) {
      const parent = documentElement(doc);
      const el = doc.context.obj({ Type: 'StructElem', S: 'Figure', P: parent.ref, Alt: PDFHexString.fromText(ins.alt) });
      const ref = doc.context.register(el);
      parent.el.set(N('K'), doc.context.obj([...kidsOf(parent.el), ref]));
      figure = { ref, el };
    }
    // Other elements on the placeholder page lose their marked content (the page goes away).
    for (const { el } of onPage) {
      if (el === figure.el) continue;
      const kids = kidsOf(el).filter((k) => !(k instanceof PDFNumber) && !(k instanceof PDFDict && k.get(N('Type')) === N('MCR')));
      el.set(N('K'), doc.context.obj(kids));
    }
    const oldKey = placeholder.node.get(N('StructParents'));
    if (oldKey instanceof PDFNumber) removeParentEntry(doc, root, oldKey.asNumber());

    const page = await copyTagged(doc, await load(ins.path), ins.page, figure.ref!);
    doc.removePage(ins.index);
    doc.insertPage(ins.index, page);
    setFigureContent(doc, figure.el, page, ins.alt);
  }
}

export interface PdfPart {
  position: 'before' | 'after';
  path: string;
  pages: number[];
  title: string;
}

/** Adds whole parts (a cover, appendices) before or after the document, in order. */
export async function addPdfParts(doc: PDFDocument, parts: PdfPart[], load: LoadSource): Promise<void> {
  if (!parts.length) return;
  const parent = documentElement(doc);
  const before: PDFRef[] = [];
  const after: PDFRef[] = [];
  let insertAt = 0;
  for (const part of parts) {
    const src = await load(part.path);
    for (let i = 0; i < part.pages.length; i++) {
      const alt = `${part.title}, page ${i + 1} of ${part.pages.length}`;
      const el = doc.context.obj({ Type: 'StructElem', S: 'Figure', P: parent.ref, Alt: PDFHexString.fromText(alt) });
      const ref = doc.context.register(el);
      const page = await copyTagged(doc, src, part.pages[i], ref);
      if (part.position === 'before') {
        doc.insertPage(insertAt++, page);
        before.push(ref);
      } else {
        doc.addPage(page);
        after.push(ref);
      }
      setFigureContent(doc, el, page, alt);
    }
  }
  parent.el.set(N('K'), doc.context.obj([...before, ...kidsOf(parent.el), ...after]));
}

export type PdfInfo = { pages: number; unembeddedFonts: boolean } | { error: string };

const infoCache = new Map<string, { mtimeMs: number; size: number; info: PdfInfo }>();

/** True when any font in the file has no embedded font program (PDF/UA requires embedding). */
function hasUnembeddedFonts(doc: PDFDocument): boolean {
  const embedded = (font: PDFDict): boolean => {
    const subtype = font.get(N('Subtype'));
    if (subtype === N('Type3')) return true;
    if (subtype === N('Type0')) {
      const descendant = font.lookupMaybe(N('DescendantFonts'), PDFArray)?.get(0);
      const cid = descendant ? doc.context.lookup(descendant) : undefined;
      return cid instanceof PDFDict ? embedded(cid) : false;
    }
    const descriptor = font.lookupMaybe(N('FontDescriptor'), PDFDict);
    return !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.get(N(k)));
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && !(obj instanceof PDFStream) && obj.get(N('Type')) === N('Font') && obj.get(N('Subtype')) !== N('CIDFontType0') && obj.get(N('Subtype')) !== N('CIDFontType2')) {
      if (!embedded(obj)) return true;
    }
  }
  return false;
}

/** Page count of a PDF in the library, or why it cannot be inserted. */
export async function pdfInfo(path: string, stat: { mtimeMs: number; size: number }, read: () => Promise<Uint8Array>): Promise<PdfInfo> {
  const hit = infoCache.get(path);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.info;
  let info: PdfInfo;
  try {
    const doc = await PDFDocument.load(await read(), { updateMetadata: false });
    info = { pages: doc.getPageCount(), unembeddedFonts: hasUnembeddedFonts(doc) };
  } catch (e) {
    const name = e instanceof Error ? e.constructor.name : '';
    info = { error: name === 'EncryptedPDFError' ? 'the PDF is encrypted, so its pages cannot be copied.' : 'the file could not be read as a PDF.' };
  }
  infoCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, info });
  return info;
}
