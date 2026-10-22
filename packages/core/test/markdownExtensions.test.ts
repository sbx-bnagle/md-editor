import { describe, expect, test } from 'vitest';
import { composeDocument, type ComposeHost } from '../src/render/compose';
import { mapPreviewEdit } from '../src/previewEdit';

const host = (text: string): ComposeHost => ({ readText: async () => text, exists: async () => true, assetUrl: (p) => p });
const render = async (text: string) => (await composeDocument(host(text), { docPath: '/p/doc.md', projectRoot: '/p', baseScope: {} })).html.replace(/\n/g, '');

describe('tables that start with a separator row', () => {
  test('render as a table with a body and no header', async () => {
    const html = await render('|:--|:-:|--:|\n| a | b \\| c | `d` |\n| f |\n\nAfter.\n');
    expect(html).toContain('<table data-src-line="0"><tbody><tr data-src-line="1">');
    expect(html).not.toContain('<thead');
    expect(html).toContain('<td style="text-align:left">a</td><td style="text-align:center">b | c</td><td style="text-align:right"><code>d</code></td>');
    // Missing cells are added empty; the block ends at the blank line.
    expect(html).toContain('<tr data-src-line="2"><td style="text-align:left">f</td><td style="text-align:center"></td><td style="text-align:right"></td></tr></tbody></table>');
    expect(html).toContain('<p data-src-line="4">After.</p>');
  });

  test('the pasted example', async () => {
    const row = '| the quick brown fox jumps over the lazy dog. '.repeat(3) + '|';
    const html = await render(`|:--|:--|:--|\n${row}\n`);
    expect(html.match(/<td /g)).toHaveLength(3);
  });

  test('standard markdown keeps its meaning', async () => {
    // A header row above the separator: a normal table with a header.
    expect(await render('| A | B |\n|---|---|\n| 1 | 2 |\n')).toContain('<thead>');
    // Text, then a separator row: not interrupted (as in standard markdown).
    expect(await render('Some text\n|---|---|---|\n| 1 | 2 | 3 |\n')).not.toContain('<table');
    // A separator row alone, or followed by another block, is not a table.
    expect(await render('|---|---|\n')).not.toContain('<table');
    expect(await render('|---|---|\n# Heading\n')).not.toContain('<table');
    // Rules, setext headings and lists are unchanged.
    expect(await render('Title\n---\n\n---\n\n- a\n')).toMatch(/<h2[^>]*>Title<\/h2><hr[^>]*><ul/);
  });

  test('preview editing still finds the paragraph after such a table', () => {
    const src = '|:--|:--|\n| a | b |\n\nEdit me.\n';
    const r = mapPreviewEdit(src, { line: 3, before: 'Edit me.', after: 'Edited me.' });
    expect(r && !('error' in r) && src.slice(0, r.from) + r.insert + src.slice(r.to)).toBe('|:--|:--|\n| a | b |\n\nEdited me.\n');
  });
});

describe('==marked text==', () => {
  test('renders as <mark>', async () => {
    expect(await render('A ==marked *and emphasised*== word.\n')).toContain('<p data-src-line="0">A <mark>marked <em>and emphasised</em></mark> word.</p>');
    expect(await render('**==both==**\n')).toContain('<strong><mark>both</mark></strong>');
  });

  test('left alone where it is not a pair', async () => {
    expect(await render('a == b, and x ==y\n')).toContain('a == b, and x ==y');
    expect(await render('`==code==`\n')).toContain('<code>==code==</code>');
    expect(await render('a=b ==\n')).not.toContain('<mark>');
  });

  test('preview editing works inside marked text', () => {
    const src = 'A ==marked== word.\n';
    const r = mapPreviewEdit(src, { line: 0, before: 'A marked word.', after: 'A marked big word.' });
    expect(r && !('error' in r) && src.slice(0, r.from) + r.insert + src.slice(r.to)).toBe('A ==marked== big word.\n');
  });
});

test('readability text leaves out == marks, keeping positions', async () => {
  const { plainProse } = await import('../src/prose');
  const src = 'A ==marked== word, and a == b.';
  const out = plainProse(src);
  expect(out).toHaveLength(src.length);
  expect(out.replace(/\s+/g, ' ')).toBe('A marked word, and a == b.');
});
