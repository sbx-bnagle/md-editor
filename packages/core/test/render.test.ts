import { describe, expect, test } from 'vitest';
import { composeDocument, type ComposeHost } from '../src/render/compose';
import { buildDocumentCss, pageContentWidth, rewriteMarginBoxVariables, rewriteCssUrls } from '../src/render/theme';

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
    expect(doc.html).not.toContain('>outside<');
    expect(doc.html).toContain('Outside the project: ../../Other/x.md');
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

test('dashes in prose but not code, HTML or rules', async () => {
  const host = memoryHost({ [`${P}/main.md`]: 'a -- b --- c `x -- y`\n\n<!-- note -->\n\n---\n\n___\n' });
  const doc = await composeDocument(host, { docPath: `${P}/main.md`, projectRoot: P, baseScope: {} });
  expect(doc.html).toContain('a – b — c <code>x -- y</code>');
  expect(doc.html).toContain('<!-- note -->');
  expect((doc.html.match(/<hr/g) ?? []).length).toBe(2);
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

  test('nested var() fallbacks', () => {
    expect(rewriteMarginBoxVariables('@page { @top-left { content: var(--title, var(--project)); } }', ['project'])).toBe(
      '@page { @top-left { content: var(--title, string(mde-var-project)); } }',
    );
    expect(rewriteMarginBoxVariables('@page { @top-left { content: var(--title, var(--project)) " x"; } }', ['title', 'project'])).toBe(
      '@page { @top-left { content: string(mde-var-title) " x"; } }',
    );
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

describe('page content width', () => {
  test('reads size and margins from @page, ignoring margin boxes and :first', () => {
    expect(pageContentWidth('')).toBe(624);
    expect(pageContentWidth('@page { size: letter; margin: 1in 1in 0.9in; @top-left { margin: 3in; } } @page :first { margin: 2in; }')).toBe(624);
    expect(pageContentWidth('@page { size: letter; margin: 0.95in 0.9in 0.9in 0.9in; }')).toBe(643);
    expect(pageContentWidth('@page { size: A4; margin: 20mm; }')).toBe(Math.round((210 - 40) * 96 / 25.4));
    expect(pageContentWidth('@page { size: letter landscape; margin: 0.5in; }')).toBe(960);
    expect(pageContentWidth('@page { size: 6in 9in; margin: 0.75in 0.5in 0.75in 1in; }')).toBe(432);
  });
});

describe('diagrams and accessibility warnings', () => {
  test('mermaid fences and .mmd blocks become described figures', async () => {
    const host = memoryHost({
      [`${P}/main.md`]: '# Plan\n\n```mermaid\ngantt\n  accTitle: Schedule\n  accDescr: Two tasks in March.\n  title Ignored for alt\n```\n\n/flow.mmd "Request flow"\n',
      [`${P}/flow.mmd`]: 'flowchart LR\n  A --> B\n',
    });
    const doc = await composeDocument(host, { docPath: `${P}/main.md`, projectRoot: P, baseScope: {} });
    expect(doc.warnings).toEqual([]);
    expect(doc.html).toContain('<figure class="mde-diagram" role="group" data-break-inside="avoid" data-src-line="2"><div class="mde-mermaid" role="img" aria-label="Schedule. Two tasks in March.">');
    expect(doc.html).toContain('aria-label="Request flow"');
    expect(doc.html).toContain('<figcaption>Request flow</figcaption>');
    expect(doc.html).toContain('<pre class="mde-diagram-source">flowchart LR\n  A --&gt; B</pre>');
  });

  test('warns about undescribed images and diagrams and skipped heading levels', async () => {
    const host = memoryHost({
      [`${P}/main.md`]: '## Starts at two\n\n#### Skips three\n\n![](a.png)\n\n/b.png\n\n```mermaid\npie\n  "A" : 1\n```\n',
      [`${P}/a.png`]: 'x',
      [`${P}/b.png`]: 'x',
    });
    const doc = await composeDocument(host, { docPath: `${P}/main.md`, projectRoot: P, baseScope: {} });
    const a11y = doc.warnings.filter((w) => w.kind === 'accessibility');
    expect(a11y.map((w) => w.line)).toEqual([0, 2, 4, 6, 8]);
    expect(a11y[0].message).toMatch(/first heading .* is level 2/);
    expect(a11y.map((w) => w.code)).toEqual(['first-heading-level', undefined, undefined, undefined, undefined]);
    expect(doc.firstHeading).toEqual({ level: 2, text: 'Starts at two' });
    expect(a11y[1].message).toMatch(/skips from level 2 to 4/);
    expect(a11y[2].message).toMatch(/Image “a.png” has no description/);
    expect(a11y[3].message).toMatch(/Image “\/b.png” has no description/);
    expect(a11y[4].message).toMatch(/^Pie chart has no description/);
    expect(doc.html).toContain('<figure class="mde-figure" role="group"');
  });
});
