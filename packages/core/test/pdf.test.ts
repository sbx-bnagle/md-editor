import { describe, expect, test } from 'vitest';
import { markUntaggedAsArtifacts } from '../src/pdf/artifacts';

const run = (s: string) => {
  const r = markUntaggedAsArtifacts(new TextEncoder().encode(s));
  return { text: new TextDecoder().decode(r.bytes), wrapped: r.wrapped };
};

describe('artifact marking', () => {
  test('wraps untagged paths, text and images; leaves tagged content alone', () => {
    const src = [
      '1 1 1 rg 0 0 612 792 re f',
      '/P <</MCID 0>> BDC BT /F1 12 Tf (Tagged) Tj ET EMC',
      'BT /F1 9 Tf 72 40 Td (Page 1) Tj [(Foot) -20 (er)] TJ ET',
      'q 10 0 0 10 0 0 cm /Im1 Do Q',
      '0 0 m 100 0 l S',
      '0 0 100 100 re W n',
    ].join('\n');
    const { text, wrapped } = run(src);
    expect(wrapped).toBe(5);
    expect(text).toContain('/Artifact BMC\n0 0 612 792 re f\nEMC');
    expect(text).toContain('/P <</MCID 0>> BDC BT /F1 12 Tf (Tagged) Tj ET EMC');
    expect(text).toContain('/Artifact BMC\n(Page 1) Tj\nEMC');
    expect(text).toContain('/Artifact BMC\n[(Foot) -20 (er)] TJ\nEMC');
    expect(text).toContain('/Artifact BMC\n/Im1 Do\nEMC');
    expect(text).toContain('/Artifact BMC\n0 0 m 100 0 l S\nEMC');
    expect(text).toContain('0 0 100 100 re W n');
    expect(text).not.toContain('/Artifact BMC\n0 0 100 100 re W n');
  });

  test('content nested inside a tagged sequence or an existing artifact stays as is', () => {
    const src = '/Span <</MCID 3>> BDC /Span <</ActualText (fi)>> BDC (fi) Tj EMC EMC /Artifact BMC (x) Tj EMC';
    expect(run(src)).toEqual({ text: src, wrapped: 0 });
  });

  test('a span without an MCID does not count as tagged', () => {
    const { text } = run('BT /Span <</ActualText (ff)>> BDC (ff) Tj EMC ET');
    expect(text).toBe('BT /Span <</ActualText (ff)>> BDC /Artifact BMC\n(ff) Tj\nEMC EMC ET');
  });

  test('strings with delimiters and escapes do not confuse the tokenizer', () => {
    const { text, wrapped } = run('BT (a \\) Tj ( nested) ] <<) Tj ET');
    expect(wrapped).toBe(1);
    expect(text).toBe('BT /Artifact BMC\n(a \\) Tj ( nested) ] <<) Tj\nEMC ET');
  });

  test('Do of a form with its own tagged content is left for the form to handle', () => {
    const r = markUntaggedAsArtifacts(new TextEncoder().encode('/Fm1 Do /Im2 Do'), (name) => name === 'Fm1');
    expect(new TextDecoder().decode(r.bytes)).toBe('/Fm1 Do /Artifact BMC\n/Im2 Do\nEMC');
  });

  test('inline images are wrapped whole', () => {
    const { text } = run('q BI /W 1 /H 1 /BPC 8 /CS /G ID \u0000ÿ EI Q');
    expect(text).toBe('q /Artifact BMC\nBI /W 1 /H 1 /BPC 8 /CS /G ID \u0000ÿ EI\nEMC Q');
  });
});

describe('stripping marked content', () => {
  test('removes tags but keeps optional content', async () => {
    const { stripMarkedContent } = await import('../src/pdf/artifacts');
    const src = '/P <</MCID 3>> BDC BT (Hi) Tj ET EMC /OC /L1 BDC /Artifact BMC 0 0 1 1 re f EMC EMC';
    const out = new TextDecoder().decode(stripMarkedContent(new TextEncoder().encode(src)));
    expect(out.replace(/\s+/g, ' ').trim()).toBe('BT (Hi) Tj ET /OC /L1 BDC 0 0 1 1 re f EMC');
  });
});
