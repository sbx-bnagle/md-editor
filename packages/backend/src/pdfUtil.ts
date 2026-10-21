// Small pdf-lib helpers shared by the PDF accessibility pass and PDF inserts.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFObject } from 'pdf-lib';

export const N = (s: string) => PDFName.of(s);

export function streamBytes(stream: PDFObject | undefined): Uint8Array | null {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (stream instanceof PDFStream) return stream.getContents();
  return null;
}

export function concatBytes(parts: Uint8Array[], separator = 0x0a): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length + 1, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    out[o + p.length] = separator;
    o += p.length + 1;
  }
  return out;
}

/** Decoded content of a page (its content streams joined). */
export function pageContent(doc: PDFDocument, pageNode: PDFDict): Uint8Array {
  const contents = pageNode.get(N('Contents'));
  const refs: PDFObject[] = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return concatBytes(refs.map((r) => streamBytes(doc.context.lookup(r)) ?? new Uint8Array()));
}

/** Replaces a stream's content, keeping its dictionary (BBox, Resources, StructParents, …). */
export function replaceStream(doc: PDFDocument, ref: PDFRef, bytes: Uint8Array): void {
  const old = doc.context.lookup(ref);
  if (!(old instanceof PDFStream)) return;
  const fresh = doc.context.flateStream(bytes);
  for (const [k, v] of old.dict.entries()) {
    if (!['Filter', 'DecodeParms', 'Length'].includes(k.decodeText())) fresh.dict.set(k, v);
  }
  doc.context.assign(ref, fresh);
}

export function structRoot(doc: PDFDocument): PDFDict | undefined {
  return doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict);
}

/** The ParentTree as one flat Nums array (Chromium writes it flat; Kids are folded in). */
export function parentTreeNums(doc: PDFDocument, root: PDFDict): PDFArray {
  let tree = root.lookupMaybe(N('ParentTree'), PDFDict);
  if (!tree) {
    tree = doc.context.obj({ Nums: [] });
    root.set(N('ParentTree'), doc.context.register(tree));
  }
  let nums = tree.lookupMaybe(N('Nums'), PDFArray);
  const kids = tree.lookupMaybe(N('Kids'), PDFArray);
  if (!nums || kids) {
    const flat: PDFObject[] = [];
    const collect = (node: PDFDict) => {
      const n = node.lookupMaybe(N('Nums'), PDFArray);
      if (n) flat.push(...n.asArray());
      for (const k of node.lookupMaybe(N('Kids'), PDFArray)?.asArray() ?? []) collect(doc.context.lookup(k, PDFDict));
    };
    collect(tree);
    nums = doc.context.obj(flat);
    tree.set(N('Nums'), nums);
    tree.delete(N('Kids'));
  }
  return nums;
}

export function nextParentKey(nums: PDFArray, root: PDFDict): number {
  let max = -1;
  for (let i = 0; i < nums.size(); i += 2) max = Math.max(max, (nums.get(i) as PDFNumber).asNumber());
  const next = root.get(N('ParentTreeNextKey'));
  return Math.max(max + 1, next instanceof PDFNumber ? next.asNumber() : 0);
}

export function addParentEntry(doc: PDFDocument, root: PDFDict, value: PDFObject): number {
  const nums = parentTreeNums(doc, root);
  const key = nextParentKey(nums, root);
  nums.push(PDFNumber.of(key));
  nums.push(value);
  root.set(N('ParentTreeNextKey'), PDFNumber.of(key + 1));
  return key;
}

export function removeParentEntry(doc: PDFDocument, root: PDFDict, key: number): void {
  const nums = parentTreeNums(doc, root);
  for (let i = 0; i + 1 < nums.size(); i += 2) {
    if ((nums.get(i) as PDFNumber).asNumber() === key) {
      nums.remove(i + 1);
      nums.remove(i);
      return;
    }
  }
}

export function typeOf(doc: PDFDocument, o: PDFObject | undefined): string | null {
  const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
  if (!(d instanceof PDFDict)) return null;
  const s = d.get(N('S'));
  return s instanceof PDFName ? s.decodeText() : null;
}

export function kidsOf(el: PDFDict): PDFObject[] {
  const k = el.get(N('K'));
  if (!k) return [];
  return k instanceof PDFArray ? k.asArray() : [k];
}

/** Every structure element (with its reference when it has one), depth first. */
export function structElements(doc: PDFDocument): Array<{ ref: PDFRef | null; el: PDFDict }> {
  const root = structRoot(doc);
  const out: Array<{ ref: PDFRef | null; el: PDFDict }> = [];
  if (!root) return out;
  const seen = new Set<PDFObject>();
  const visit = (o: PDFObject) => {
    if (seen.has(o)) return;
    seen.add(o);
    const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
    if (d instanceof PDFArray) return d.asArray().forEach(visit);
    if (!(d instanceof PDFDict) || !d.get(N('S'))) return;
    out.push({ ref: o instanceof PDFRef ? o : null, el: d });
    for (const k of kidsOf(d)) visit(k);
  };
  const k = root.get(N('K'));
  if (k) visit(k);
  return out;
}

/** The Document element (Chromium's top element), creating one if the tree has none. */
export function documentElement(doc: PDFDocument): { ref: PDFRef; el: PDFDict } {
  let root = structRoot(doc);
  if (!root) {
    root = doc.context.obj({ Type: 'StructTreeRoot' });
    doc.catalog.set(N('StructTreeRoot'), doc.context.register(root));
  }
  for (const k of kidsOf(root)) {
    if (k instanceof PDFRef && typeOf(doc, k) === 'Document') return { ref: k, el: doc.context.lookup(k, PDFDict) };
  }
  const rootRef = doc.context.getObjectRef(root) ?? doc.catalog.get(N('StructTreeRoot'));
  const el = doc.context.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: kidsOf(root) });
  const ref = doc.context.register(el);
  for (const k of kidsOf(el)) {
    const d = k instanceof PDFRef ? doc.context.lookup(k) : k;
    if (d instanceof PDFDict && d.get(N('S'))) d.set(N('P'), ref);
  }
  root.set(N('K'), ref);
  return { ref, el };
}
