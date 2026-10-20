import { describe, expect, test } from 'vitest';
import { composeDocument, type ComposeHost } from '../src/render/compose';
import { buildDocumentCss, rewriteMarginBoxVariables, rewriteCssUrls } from '../src/render/theme';

function memoryHost(files: Record<string, string>): ComposeHost {
  return {
    readText: async (p) => (p in files ? files[p] : null),
    exists: async (p) => p in files,
    assetUrl: (p) => `asset://${p}`,
  };
}

const P = '/lib/Collections/C/Proj';

describe('compose', () => {
  test('transclusion with inherited and locally overridden variables', async () => {
    const host = memoryHost({
      [`${P}/main.md`]: '---\ntitle: Annual Report\nclient: Acme\n---\n# {{title}}\n\nFor {{client}}.\n\n/sections/intro.md\n\nAfter {{title}}.\n',
      [`${P}/sections/intro.md`]: '---\ntitle: Introduction\n---\n## {{title}} for {{client}}\n\n![logo](../img/logo.png)\n',
      [`${P}/img/logo.png`]: 'PNG',
    });
    const doc = await composeDocument(host, { docPath: `${P}/main.md`, projectRoot: P, baseScope: { today: 'October 20, 2026' } });
    expect(doc.warnings).toEqual([]);
    expect(doc.rootScope).toMatchObject({ title: 'Annual Report', client: 'Acme', today: 'October 20, 2026' });
    expect(doc.html).toContain('<h1 data-src-line="4" id="annual-report">Annual Report</h1>');
    expect(doc.html).toContain('<h2 data-src-line="3" id="introduction-for-acme">Introduction for Acme</h2>');
    expect(doc.html).toContain('<p data-src-line="10">After Annual Report.</p>');
    expect(doc.html).toContain('src="asset:///lib/Collections/C/Proj/img/logo.png"');
    // Child scope marker, then restore marker for the parent's value.
    expect(doc.html).toMatch(/<section class="mde-include" data-src-file="sections\/intro.md"[^>]*><div class="mde-vars" aria-hidden="true"><span class="mde-var" data-var="title">Introduction<\/span><\/div>/);
    expect(doc.html).toContain('</section><div class="mde-vars" aria-hidden="true"><span class="mde-var" data-var="title">Annual Report</span></div>');
    expect(doc.dependencies).toContain(`${P}/sections/intro.md`);
  });

  test('leading slash paths resolve relative to the including document', async () => {
    const host = memoryHost({
      [`${P}/a/doc.md`]: '/b.md\n',
      [`${P}/a/b.md`]: 'B text',
    });
    const doc = await composeDocument(host, { docPath: `${P}/a/doc.md`, projectRoot: P, baseScope: {} });
    expect(doc.html).toContain('B text');
  });

  test('csv, code, missing files, cycles, unsupported and outside-project warnings', async () => {
    const host = memoryHost({
      [`${P}/main.md`]: '/data.csv "Totals"\n\n/code.py\n\n/missing.md\n\n/self.md\n\n/file.pages\n\n../../Other/x.md\n',
      [`${P}/data.csv`]: 'Item,Cost\n*Pens*,3\n',
      [`${P}/code.py`]: 'print("hi")\n',
      [`${P}/self.md`]: '/main.md\n',
      ['/lib/Collections/Other/x.md']: 'outside',
    });
    const doc = await composeDocument(host, { docPath: `${P}/main.md`, projectRoot: P, baseScope: {} });
    expect(doc.html).toContain('<caption>Totals</caption><thead><tr><th>Item</th><th>Cost</th></tr></thead><tbody><tr><td><em>Pens</em></td><td>3</td></tr>');
    expect(doc.html).toContain('class="hljs language-python"');
    expect(doc.html).toContain('outside');
    const kinds = doc.warnings.map((w) => w.kind).sort();
    expect(kinds).toEqual(['cycle', 'missing-file', 'outside-project', 'unsupported']);
    expect(doc.warnings.find((w) => w.kind === 'missing-file')).toMatchObject({ source: `${P}/main.md`, line: 4 });
  });

  test('unsaved overrides and annotation blocks are respected', async () => {
    const host = memoryHost({ [`${P}/main.md`]: 'disk' });
    const doc = await composeDocument(host, {
      docPath: `${P}/main.md`,
      projectRoot: P,
      baseScope: {},
      overrides: { [`${P}/main.md`]: 'buffer\n\n---\nAnnotations: 0,7 SHA-256 0000000000000000000000000\n@Me: 0,6\n...\n' },
    });
    expect(doc.html).toContain('buffer');
    expect(doc.html).not.toContain('Annotations');
  });

  test('content blocks inside fenced code are left alone', async () => {
    const host = memoryHost({ [`${P}/main.md`]: '```\n/other.md\n```\n' });
    const doc = await composeDocument(host, { docPath: `${P}/main.md`, projectRoot: P, baseScope: {} });
    expect(doc.html).toContain('/other.md');
    expect(doc.warnings).toEqual([]);
  });
});

describe('theme css', () => {
  test('margin box variables become running strings; other var() uses are untouched', () => {
    const css = '@page { @top-center { content: var(--title); color: var(--accent); } @bottom-left { content: "For " var(--client-name, "x") " " counter(page); } }\nh1 { color: var(--title); }';
    const out = rewriteMarginBoxVariables(css, ['title', 'client.name']);
    expect(out).toContain('content: string(mde-var-title);');
    expect(out).toContain('color: var(--accent)');
    expect(out).toContain('content: "For " string(mde-var-client-name) " " counter(page);');
    expect(out).toContain('h1 { color: var(--title); }');
  });

  test('relative urls resolve against the theme folder', () => {
    expect(rewriteCssUrls('src: url("fonts/a.woff2"), url(data:x), url(https://x/y.png)', '/lib/Themes/T', (p) => `asset://${p}`)).toBe(
      'src: url("asset:///lib/Themes/T/fonts/a.woff2"), url(data:x), url(https://x/y.png)',
    );
  });

  test('document css includes base, theme and variable rules', () => {
    const css = buildDocumentCss({ themeCss: 'p{}', themeDir: '/t', rootScope: { title: 'A "B"' }, variableNames: ['title', 'part'], assetUrl: (p) => p });
    expect(css).toContain('--title: "A \\"B\\"";');
    expect(css).toContain('.mde-var[data-var="part"] { string-set: mde-var-part content(text); }');
  });
});
