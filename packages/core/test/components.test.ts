import { describe, expect, test } from 'vitest';
import { findInlineIncludes, parseIncludeArgs, parseIncludeLine, renderComponent, type TemplateContext } from '../src/components';
import { composeDocument, type ComposeHost } from '../src/render/compose';

const ctx = (include: TemplateContext['include'], templates: Record<string, string> = {}, vars: Record<string, string> = {}): TemplateContext => ({
  include,
  vars,
  load: async (n) => templates[n] ?? null,
  markdownify: (t) => t.replace(/\*(.+?)\*/g, '<em>$1</em>'),
  themeUrl: (rel) => `theme://${rel}`,
});

const html = async (src: string, c: TemplateContext) => {
  const r = await renderComponent(src, c);
  if ('error' in r) throw new Error(r.error);
  return r.html;
};

describe('component templates', () => {
  test('parameters, variables, defaults, escaping and filters', async () => {
    expect(await html('<img alt="{{ include.alt | default: include.caption }}">', ctx({ caption: 'A "plan" & map' }))).toBe('<img alt="A &quot;plan&quot; &amp; map">');
    expect(await html('{{ include.size | default: "full" }}|{{ title | upcase }}', ctx({}, {}, { title: 'Report' }))).toBe('full|REPORT');
    expect(await html('{{ include.caption | markdownify }}', ctx({ caption: 'an *odd* one' }))).toBe('an <em>odd</em> one');
    expect(await html('{{ "logo.svg" | theme_url }}', ctx({}))).toBe('theme://logo.svg');
    expect(await html('<img alt="{{ include.alt | default: include.caption | plain }}">', ctx({ caption: 'an *odd* & "x"' }))).toBe('<img alt="an odd &amp; &quot;x&quot;">');
    expect(await renderComponent('{{ x | shout }}', ctx({}))).toEqual({ error: 'The filter “shout” is not supported in components.' });
  });

  test('conditions', async () => {
    const t = '{% if include.size == "half" %}H{% elsif include.caption and include.alt %}CA{% elsif include.caption %}C{% else %}-{% endif %}{% unless include.caption %}!{% endunless %}';
    expect(await html(t, ctx({ size: 'half' }))).toBe('H!');
    expect(await html(t, ctx({ caption: 'c', alt: 'a' }))).toBe('CA');
    expect(await html(t, ctx({ caption: 'c' }))).toBe('C');
    expect(await html(t, ctx({}))).toBe('-!');
    expect(await html('{% if include.flag %}on{% else %}off{% endif %}', ctx({ flag: false }))).toBe('off');
    expect(await html('a{% comment %} ignored {{ x }} {% endcomment %}b', ctx({}))).toBe('ab');
    expect(await renderComponent('{% if x %}open', ctx({}))).toEqual({ error: 'Missing “{% endif %}”.' });
    expect(await renderComponent('{% for x in y %}{% endfor %}', ctx({}))).toEqual({ error: '“{% for %}” is not supported in components.' });
  });

  test('nested includes and missing ones', async () => {
    const c = ctx({ name: 'Ada' }, { 'inner.html': '[{{ include.who }}]' });
    expect(await html('<b>{% include inner.html who=include.name %}</b>', { ...c, vars: { 'include.name': 'x' } })).toBe('<b>[x]</b>');
    expect(await html('{% include inner.html who="Grace" %}', c)).toBe('[Grace]');
    expect(await renderComponent('{% include nope.html %}', c)).toEqual({ error: 'The component “nope.html” was not found.' });
  });

  test('tags and arguments', () => {
    expect(parseIncludeLine('{% include figure.html src="a b.png" size=half %}')).toEqual({ name: 'figure.html', args: ' src="a b.png" size=half' });
    expect(parseIncludeLine('Text {% include x.html %}')).toBeNull();
    expect(parseIncludeArgs(` a="x \\"y\\"" b='z' c=client d=half e=true`, { client: 'Acme' })).toEqual({ a: 'x "y"', b: 'z', c: 'Acme', d: 'half', e: true });
    const text = 'See {% include icon.html name="x" %} here `{% include no.html %}`\n```\n{% include fenced.html %}\n```\nand {% include y.html %}';
    expect(findInlineIncludes(text).map((f) => [f.tag.name, text.slice(f.from, f.to)])).toEqual([
      ['icon.html', '{% include icon.html name="x" %}'],
      ['y.html', '{% include y.html %}'],
    ]);
  });
});

const P = '/lib/Collections/C/Proj';
function host(files: Record<string, string>, components: Record<string, string>): ComposeHost {
  return {
    readText: async (p) => (p in files ? files[p] : null),
    exists: async (p) => p in files,
    assetUrl: (p) => `asset://${p}`,
    loadComponent: async (n) => components[n] ?? null,
  };
}

describe('components in documents', () => {
  const components = {
    'figure.html': '<figure class="size-{{ include.size | default: "full" }}">\n  <img src="{{ include.src }}" alt="{{ include.alt | default: include.caption }}">\n</figure>',
    'badge.html': '<span class="badge">{{ include.text | default: client }}</span>',
    'footer.html': '<div>{{ footer | default: title }}</div><img src="logo.png" alt="">',
  };

  test('block and inline components, variables in arguments, assets and line numbers', async () => {
    const files = {
      [`${P}/docs/main.md`]: '---\ntitle: Report\nclient: Acme\n---\n# Report\n\n{% include figure.html src="/img/plan.png" caption="Plan for {{client}}" size=half %}\n\nMade for {% include badge.html %} today.\n',
    };
    const doc = await composeDocument(host(files, components), { docPath: `${P}/docs/main.md`, projectRoot: P, baseScope: {} });
    expect(doc.warnings).toEqual([]);
    expect(doc.components.sort()).toEqual(['badge.html', 'figure.html']);
    expect(doc.html).toContain(`<div class="mde-component" data-component="figure.html" data-src-line="6"><figure class="size-half">\n  <img src="asset://${P}/docs/img/plan.png" alt="Plan for Acme">\n</figure></div>`);
    expect(doc.html).toContain('<p data-src-line="8">Made for <span class="badge">Acme</span> today.</p>');
  });

  test('page-wide components from the theme default or front matter; warnings', async () => {
    const opts = { docPath: `${P}/main.md`, projectRoot: P, baseScope: {}, pageIncludes: ['footer.html'] };
    const plain = await composeDocument(host({ [`${P}/main.md`]: '---\ntitle: T\n---\n# T\n' }, components), opts);
    expect(plain.html).toContain('<div class="mde-page-include mde-page-include-footer" aria-hidden="true"><div>T</div><img src="asset:///lib/Collections/C/Proj/logo.png" alt=""></div>');
    expect(plain.warnings).toEqual([]);
    const off = await composeDocument(host({ [`${P}/main.md`]: '---\ntitle: T\npage-includes: none\n---\n# T\n' }, components), opts);
    expect(off.html).not.toContain('mde-page-include');
    const bad = await composeDocument(host({ [`${P}/main.md`]: '# T\n\n{% include figure.html src="a.png" %}\n\n{% include gone.html %}\n' }, components), { ...opts, pageIncludes: [] });
    expect(bad.warnings.map((w) => [w.kind, w.line])).toEqual([
      ['accessibility', 2],
      ['missing-file', 4],
    ]);
    expect(bad.html).toContain('Component not found: gone.html');
  });
});
