// Post-processes Chromium's tagged PDF toward PDF/UA-1 (ISO 14289-1). Chromium already tags
// headings, paragraphs, lists, tables, figures with alt text and links, and sets the language
// and DisplayDocTitle. This pass adds what it leaves out:
//   - untagged decoration (backgrounds, rules, running headers and footers) becomes Artifact
//   - list item bodies are wrapped in LBody (ISO 32000-1, 14.8.4.3.3)
//   - link annotations get a Contents description (PDF/UA 7.18.5)
//   - XMP metadata with the title and the PDF/UA identification schema (PDF/UA 5, 7.1)
//   - a RoleMap for structure types PDF 1.7 does not define (Chromium writes PDF 2.0's Em, Strong)
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from 'pdf-lib';
import { markUntaggedAsArtifacts } from '@mde/core';
import { N, replaceStream, streamBytes } from './pdfUtil';

export interface AccessibilityOptions {
  title: string;
  lang: string;
  creator: string;
  /** Adds the PDF/UA-1 identification to the XMP metadata. */
  claimPdfUa: boolean;
}

export interface AccessibilityReport {
  artifacts: number;
  listBodies: number;
  linkDescriptions: number;
  roleMappings: number;
}


function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const producer = (o: AccessibilityOptions) => `${o.creator} (Chromium, pdf-lib)`;

function xmp(o: AccessibilityOptions, date: Date): string {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const t = escapeXml(o.title);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"${o.claimPdfUa ? '\n    xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"' : ''}>
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${t}</rdf:li></rdf:Alt></dc:title>
   <dc:language><rdf:Bag><rdf:li>${escapeXml(o.lang)}</rdf:li></rdf:Bag></dc:language>
   <xmp:CreatorTool>${escapeXml(o.creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:MetadataDate>${iso}</xmp:MetadataDate>
   <pdf:Producer>${escapeXml(producer(o))}</pdf:Producer>${o.claimPdfUa ? '\n   <pdfuaid:part>1</pdfuaid:part>' : ''}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}


/**
 * Wraps untagged painting operations in Artifact marked content: on every page, and inside
 * form XObjects that carry tagged content of their own (Chromium draws SVG this way).
 */
function markArtifacts(doc: PDFDocument): number {
  let total = 0;
  const doneForms = new Set<PDFRef>();

  /** Names of form XObjects in `resources` whose content is tagged; marks inside them once. */
  const taggedForms = (resources: PDFDict | undefined, depth: number): Set<string> => {
    const names = new Set<string>();
    const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
    if (!xobjects) return names;
    for (const [name, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef)) continue;
      const form = doc.context.lookup(value);
      if (!(form instanceof PDFStream) || form.dict.get(N('Subtype')) !== N('Form')) continue;
      const bytes = streamBytes(form);
      if (!bytes) continue;
      const tagged = form.dict.has(N('StructParents')) || /\/MCID\s/.test(new TextDecoder('latin1').decode(bytes));
      if (!tagged) continue;
      names.add(name.decodeText());
      if (doneForms.has(value) || depth > 8) continue;
      doneForms.add(value);
      const inner = taggedForms(form.dict.lookupMaybe(N('Resources'), PDFDict), depth + 1);
      const { bytes: marked, wrapped } = markUntaggedAsArtifacts(bytes, (n) => inner.has(n));
      if (wrapped) {
        total += wrapped;
        replaceStream(doc, value, marked);
      }
    }
    return names;
  };

  for (const page of doc.getPages()) {
    const contents = page.node.get(N('Contents'));
    const refs: PDFObject[] = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    // Concatenate the page's content streams: marked content may span them.
    const chunks = refs.map((r) => streamBytes(doc.context.lookup(r)) ?? new Uint8Array());
    const joined = new Uint8Array(chunks.reduce((s, c) => s + c.length + 1, 0));
    let o = 0;
    for (const c of chunks) {
      joined.set(c, o);
      joined[o + c.length] = 0x0a;
      o += c.length + 1;
    }
    const forms = taggedForms(page.node.Resources(), 0);
    const { bytes, wrapped } = markUntaggedAsArtifacts(joined, (n) => forms.has(n));
    if (!wrapped) continue;
    total += wrapped;
    page.node.set(N('Contents'), doc.context.register(doc.context.flateStream(bytes)));
  }
  return total;
}

/** Reads a number tree (ParentTree) into a map. */
function readNumberTree(doc: PDFDocument, node: PDFDict | undefined, out: Map<number, PDFObject>) {
  if (!node) return;
  const nums = node.lookupMaybe(N('Nums'), PDFArray);
  if (nums) for (let i = 0; i + 1 < nums.size(); i += 2) out.set((nums.get(i) as PDFNumber).asNumber(), nums.get(i + 1));
  const kids = node.lookupMaybe(N('Kids'), PDFArray);
  if (kids) for (const k of kids.asArray()) readNumberTree(doc, doc.context.lookup(k, PDFDict), out);
}

/** Wraps everything in an LI except its Lbl in an LBody element. */
function addListBodies(doc: PDFDocument): number {
  const root = doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict);
  if (!root) return 0;
  const parentTree = new Map<number, PDFObject>();
  readNumberTree(doc, root.lookupMaybe(N('ParentTree'), PDFDict), parentTree);
  let count = 0;

  const kidsOf = (el: PDFDict): PDFObject[] => {
    const k = el.get(N('K'));
    if (!k) return [];
    return k instanceof PDFArray ? k.asArray() : [k];
  };
  const typeOf = (o: PDFObject): string | null => {
    const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
    if (!(d instanceof PDFDict)) return null;
    const s = d.get(N('S'));
    return s instanceof PDFName ? s.decodeText() : null;
  };

  const visit = (ref: PDFObject) => {
    const el = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(el instanceof PDFDict)) return;
    const kids = kidsOf(el);
    if (typeOf(el) === 'LI' && ref instanceof PDFRef) {
      const types = kids.map(typeOf);
      const body = kids.filter((_, i) => types[i] !== 'Lbl' && types[i] !== 'LBody');
      if (body.length && !types.includes('LBody')) {
        const lbody = doc.context.obj({ Type: 'StructElem', S: 'LBody', P: ref, K: body });
        const pg = el.get(N('Pg'));
        if (pg) lbody.set(N('Pg'), pg);
        const lbodyRef = doc.context.register(lbody);
        for (const k of body) {
          const d = k instanceof PDFRef ? doc.context.lookup(k) : k;
          if (d instanceof PDFDict && d.get(N('S'))) d.set(N('P'), lbodyRef);
          else reparentContent(k, el, lbodyRef);
        }
        el.set(N('K'), doc.context.obj([...kids.filter((_, i) => types[i] === 'Lbl'), lbodyRef]));
        count++;
      }
    }
    for (const k of kidsOf(el)) if (k instanceof PDFRef || (k instanceof PDFDict && k.get(N('S')))) visit(k);
  };

  // Marked content and object references moved into LBody must point to it in the ParentTree.
  const reparentContent = (k: PDFObject, oldParent: PDFDict, newParent: PDFRef) => {
    let mcid: number | null = null;
    let pageRef: PDFObject | undefined = oldParent.get(N('Pg'));
    if (k instanceof PDFNumber) mcid = k.asNumber();
    else if (k instanceof PDFDict && k.get(N('Type')) === N('MCR')) {
      mcid = (k.get(N('MCID')) as PDFNumber).asNumber();
      pageRef = k.get(N('Pg')) ?? pageRef;
    } else if (k instanceof PDFDict && k.get(N('Type')) === N('OBJR')) {
      const obj = doc.context.lookup(k.get(N('Obj')));
      const sp = obj instanceof PDFDict ? obj.get(N('StructParent')) : undefined;
      if (sp instanceof PDFNumber) setParentTree(sp.asNumber(), null, newParent);
      return;
    }
    if (mcid === null || !pageRef) return;
    const page = doc.context.lookup(pageRef, PDFDict);
    const sp = page.get(N('StructParents'));
    if (sp instanceof PDFNumber) setParentTree(sp.asNumber(), mcid, newParent);
  };
  const setParentTree = (key: number, mcid: number | null, parent: PDFRef) => {
    const entry = parentTree.get(key);
    if (mcid === null) {
      // An annotation's StructParent maps straight to its element: rewrite the tree entry.
      const pt = root.lookupMaybe(N('ParentTree'), PDFDict);
      const nums = pt?.lookupMaybe(N('Nums'), PDFArray);
      if (nums) for (let i = 0; i + 1 < nums.size(); i += 2) if ((nums.get(i) as PDFNumber).asNumber() === key) nums.set(i + 1, parent);
      return;
    }
    const arr = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
    if (arr instanceof PDFArray && mcid < arr.size()) arr.set(mcid, parent);
  };

  visit(root.get(N('K'))!);
  const k = root.get(N('K'));
  if (k instanceof PDFArray) for (const c of k.asArray()) visit(c);
  return count;
}

// Standard structure types of ISO 32000-1 (PDF 1.7), 14.8.4.
const STANDARD_TYPES = new Set(
  'Document Part Art Sect Div BlockQuote Caption TOC TOCI Index NonStruct Private P H H1 H2 H3 H4 H5 H6 L LI Lbl LBody Table TR TH TD THead TBody TFoot Span Quote Note Reference BibEntry Code Link Annot Ruby RB RT RP Warichu WT WP Figure Formula Form'.split(' '),
);
// PDF 2.0 types Chromium may write, mapped to their nearest PDF 1.7 equivalent.
const PDF2_TO_17: Record<string, string> = { Em: 'Span', Strong: 'Span', Sub: 'Span', Title: 'P', FENote: 'Note', Aside: 'Sect', DocumentFragment: 'Div' };

/** Maps every non-standard structure type used in the tree to a standard one. */
function addRoleMap(doc: PDFDocument): number {
  const root = doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict);
  if (!root) return 0;
  const used = new Set<string>();
  const seen = new Set<PDFObject>();
  const visit = (o: PDFObject | undefined) => {
    if (!o || seen.has(o)) return;
    seen.add(o);
    const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
    if (d instanceof PDFArray) return d.asArray().forEach(visit);
    if (!(d instanceof PDFDict)) return;
    const s = d.get(N('S'));
    if (s instanceof PDFName) used.add(s.decodeText());
    visit(d.get(N('K')));
  };
  visit(root.get(N('K')));
  const roleMap = root.lookupMaybe(N('RoleMap'), PDFDict) ?? doc.context.obj({});
  let added = 0;
  for (const type of used) {
    if (STANDARD_TYPES.has(type) || roleMap.get(N(type))) continue;
    roleMap.set(N(type), N(PDF2_TO_17[type] ?? 'Span'));
    added++;
  }
  if (added) root.set(N('RoleMap'), roleMap);
  return added;
}

/** Gives each link annotation a text description (its URL, or where it goes in the document). */
function describeLinks(doc: PDFDocument): number {
  let count = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
    if (!annots) continue;
    for (const a of annots.asArray()) {
      const annot = doc.context.lookup(a);
      if (!(annot instanceof PDFDict) || annot.get(N('Subtype')) !== N('Link') || annot.get(N('Contents'))) continue;
      const action = annot.lookupMaybe(N('A'), PDFDict);
      const uri = action?.get(N('URI'));
      const text = uri instanceof PDFString || uri instanceof PDFHexString ? `Link to ${uri.decodeText()}` : 'Link within this document';
      annot.set(N('Contents'), PDFHexString.fromText(text));
      count++;
    }
  }
  return count;
}

export async function makeAccessiblePdf(bytes: Uint8Array, options: AccessibilityOptions): Promise<{ bytes: Uint8Array; report: AccessibilityReport }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const report = makeAccessible(doc, options);
  return { bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), report };
}

/** Applies the accessibility pass to a loaded document (see the top of this file). */
export function makeAccessible(doc: PDFDocument, options: AccessibilityOptions): AccessibilityReport {
  // A PDF printed without tags (WebKit on iPad) gets the document information only: marking its
  // content as artifacts would hide the text from screen readers, and it cannot claim PDF/UA.
  const tagged = isTagged(doc);
  if (!tagged) options = { ...options, claimPdfUa: false };
  const report: AccessibilityReport = tagged
    ? {
        artifacts: markArtifacts(doc),
        listBodies: addListBodies(doc),
        linkDescriptions: describeLinks(doc),
        roleMappings: addRoleMap(doc),
      }
    : { artifacts: 0, listBodies: 0, linkDescriptions: describeLinks(doc), roleMappings: 0 };
  const now = new Date();
  doc.setTitle(options.title, { showInWindowTitleBar: true });
  doc.setLanguage(options.lang);
  doc.setCreator(options.creator);
  doc.setProducer(producer(options));
  doc.setModificationDate(now);
  const metadata = doc.context.stream(xmp(options, now), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(N('Metadata'), doc.context.register(metadata));
  if (tagged) {
    const markInfo = doc.catalog.lookupMaybe(N('MarkInfo'), PDFDict);
    if (markInfo) markInfo.set(N('Marked'), doc.context.obj(true));
    else doc.catalog.set(N('MarkInfo'), doc.context.obj({ Marked: true }));
  }
  return report;
}

/** Whether the printer tagged the PDF (a structure tree for screen readers). */
export function isTagged(doc: PDFDocument): boolean {
  return !!doc.catalog.lookupMaybe(N('StructTreeRoot'), PDFDict);
}

/** Removes a structure tree (one that inserted pages started in an untagged PDF, which would tag those pages only). */
export function removeStructure(doc: PDFDocument): void {
  doc.catalog.delete(N('StructTreeRoot'));
  doc.catalog.delete(N('MarkInfo'));
  for (const page of doc.getPages()) page.node.delete(N('StructParents'));
}
