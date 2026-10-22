import { describe, expect, test } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from 'pdf-lib';
import { markUntaggedAsArtifacts } from '@mde/core';
import { makeAccessiblePdf } from '../src/pdfAccessibility';

const N = (s: string) => PDFName.of(s);

/** A one-page tagged PDF shaped like Chromium's output: Document > L > LI > (Lbl, P), plus a link and an untagged footer. */
async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const content = [
    '1 1 1 rg 0 0 612 792 re f',
    'BT /F1 12 Tf 72 700 Td /Lbl <</MCID 0>> BDC (1.) Tj EMC /P <</MCID 1>> BDC (Item) Tj EMC ET',
    'BT /F1 9 Tf 72 40 Td (Page 1) Tj ET',
  ].join('\n');
  page.node.set(N('Contents'), ctx.register(ctx.flateStream(content)));
  page.node.set(N('StructParents'), PDFNumber.of(0));
  const pageRef = page.ref;
  const rootRef = ctx.nextRef();
  const docRef = ctx.nextRef();
  const listRef = ctx.nextRef();
  const liRef = ctx.nextRef();
  const lblRef = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Lbl', P: liRef, Pg: pageRef, K: 0 }));
  const pRef = ctx.register(ctx.obj({ Type: 'StructElem', S: 'P', P: liRef, Pg: pageRef, K: 1 }));
  const strongRef = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Strong', P: docRef, Pg: pageRef, K: [] }));
  ctx.assign(liRef, ctx.obj({ Type: 'StructElem', S: 'LI', P: listRef, Pg: pageRef, K: [lblRef, pRef] }));
  ctx.assign(listRef, ctx.obj({ Type: 'StructElem', S: 'L', P: docRef, K: [liRef] }));
  ctx.assign(docRef, ctx.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: [listRef, strongRef] }));
  const parentTree = ctx.obj({ Nums: [0, ctx.obj([lblRef, pRef])] });
  ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: docRef, ParentTree: parentTree, ParentTreeNextKey: 1 }));
  doc.catalog.set(N('StructTreeRoot'), rootRef);
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 600, 200, 620], A: { S: 'URI', URI: PDFString.of('https://example.com') } }));
  page.node.set(N('Annots'), ctx.obj([link]));
  return doc.save({ useObjectStreams: false });
}

describe('PDF accessibility pass', () => {
  test('artifacts, list bodies, link text, role map and metadata', async () => {
    const { bytes, report } = await makeAccessiblePdf(await sample(), { title: 'Sample & Co', lang: 'en-US', creator: 'Folio Dome', claimPdfUa: true });
    expect(report).toEqual({ artifacts: 2, listBodies: 1, linkDescriptions: 1, roleMappings: 1 });

    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[0];
    const stream = doc.context.lookup(page.node.get(N('Contents'))) as PDFRawStream;
    const text = new TextDecoder().decode(decodePDFRawStream(stream).decode());
    expect(text).toContain('/Artifact BMC\n0 0 612 792 re f\nEMC');
    expect(text).toContain('/Artifact BMC\n(Page 1) Tj\nEMC');
    // Running the marker again finds nothing left untagged.
    expect(markUntaggedAsArtifacts(decodePDFRawStream(stream).decode()).wrapped).toBe(0);

    const root = doc.catalog.lookup(N('StructTreeRoot'), PDFDict);
    const find = (o: unknown, type: string): PDFDict | null => {
      const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
      if (d instanceof PDFArray) return d.asArray().map((x) => find(x, type)).find(Boolean) ?? null;
      if (!(d instanceof PDFDict)) return null;
      if (d.get(N('S')) === N(type)) return d;
      return find(d.get(N('K')), type);
    };
    const li = find(root.get(N('K')), 'LI')!;
    const kids = (li.get(N('K')) as PDFArray).asArray().map((k) => doc.context.lookup(k, PDFDict));
    expect(kids.map((k) => k.get(N('S')))).toEqual([N('Lbl'), N('LBody')]);
    const lbodyRef = (li.get(N('K')) as PDFArray).get(1) as PDFRef;
    const p = doc.context.lookup((kids[1].get(N('K')) as PDFArray).get(0), PDFDict);
    expect(p.get(N('S'))).toBe(N('P'));
    expect(p.get(N('P'))).toBe(lbodyRef);

    expect((root.lookup(N('RoleMap'), PDFDict).get(N('Strong')) as PDFName).decodeText()).toBe('Span');
    const annot = doc.context.lookup((page.node.lookup(N('Annots'), PDFArray)).get(0), PDFDict);
    expect(annot.lookup(N('Contents'))!.toString()).toMatch(/^<FEFF/);
    expect(doc.getTitle()).toBe('Sample & Co');
    expect(doc.catalog.get(N('Lang'))!.toString()).toContain('en-US');
    const vp = doc.catalog.lookup(N('ViewerPreferences'), PDFDict);
    expect(vp.get(N('DisplayDocTitle'))!.toString()).toBe('true');
    const xmp = new TextDecoder().decode((doc.context.lookup(doc.catalog.get(N('Metadata'))!) as PDFRawStream).getContents());
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Sample &amp; Co</rdf:li>');
  });

  test('no PDF/UA claim when the document has accessibility problems', async () => {
    const { bytes } = await makeAccessiblePdf(await sample(), { title: 'T', lang: 'en', creator: 'Folio Dome', claimPdfUa: false });
    const doc = await PDFDocument.load(bytes);
    const xmp = new TextDecoder().decode((doc.context.lookup(doc.catalog.get(N('Metadata'))!) as PDFRawStream).getContents());
    expect(xmp).not.toContain('pdfuaid');
  });
});
