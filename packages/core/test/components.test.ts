import { describe, expect, test } from 'vitest';
import { findInlineIncludes, parseIncludeArgs, parseIncludeLine, renderComponent, type TemplateContext } from '../src/components';
import type { TemplateValue } from '../src/variables';
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
    expect(await renderComponent('{% capture x %}{% endcapture %}', ctx({}))).toEqual({ error: '“{% capture %}” is not supported in components.' });
    expect(await renderComponent('{% endif %}', ctx({}))).toEqual({ error: '“{% endif %}” has no opening tag here.' });
  });

  test('nested includes and missing ones', async () => {
    const c = ctx({ name: 'Ada' }, { 'inner.html': '[{{ include.who }}]' });
    // As in Jekyll, include.name passes this component's parameter on.
    expect(await html('<b>{% include inner.html who=include.name %}</b>', c)).toBe('<b>[Ada]</b>');
    expect(await html('{% include inner.html who="Grace" %}', c)).toBe('[Grace]');
    expect(await renderComponent('{% include nope.html %}', c)).toEqual({ error: 'The component “nope.html” was not found.' });
  });

  const lists = (l: Record<string, TemplateValue[]>, vars: Record<string, string> = {}, include: TemplateContext['include'] = {}, templates: Record<string, string> = {}): TemplateContext => ({
    ...ctx(include, templates, vars),
    lists: l,
  });

  test('loops over lists, with forloop, else, limit, offset, reversed and ranges', async () => {
    const c = lists({ tags: ['news', 'updates', 'jekyll'] }, { tags: 'news, updates, jekyll' });
    expect(await html('{% for tag in tags %}<li>{{ tag }}</li>{% endfor %}', c)).toBe('<li>news</li><li>updates</li><li>jekyll</li>');
    expect(await html('{{ tags }}', c)).toBe('news, updates, jekyll');
    expect(await html('{% for t in tags %}{{ forloop.index }}/{{ forloop.length }}{% if forloop.first %}F{% endif %}{% if forloop.last %}L{% endif %} {% endfor %}', c)).toBe('1/3F 2/3 3/3L ');
    expect(await html('{% for t in tags limit:2 %}{{ t }} {% endfor %}|{% for t in tags offset:1 %}{{ t }} {% endfor %}|{% for t in tags reversed %}{{ t }} {% endfor %}', c)).toBe(
      'news updates |updates jekyll |jekyll updates news ',
    );
    expect(await html('{% for t in missing %}x{% else %}none{% endfor %}', c)).toBe('none');
    expect(await html('{% for n in (1..3) %}{{ n }}{% endfor %}', c)).toBe('123');
    expect(await renderComponent('{% for t in tags %}{% break %}{% endfor %}', c)).toEqual({ error: '“{% break %}” is not supported in components.' });
    expect(await renderComponent('{% for t in tags %}x', c)).toEqual({ error: 'Missing “{% endfor %}”.' });
    expect(await renderComponent('{% for tags %}{% endfor %}', c)).toEqual({ error: 'Cannot read “{% for tags %}” (write {% for item in list %}).' });
  });

  test('lists of mappings, list properties and filters', async () => {
    const people: TemplateValue[] = [
      { name: 'Ada', role: 'Lead', skills: ['math', 'engines'], active: true },
      { name: 'Grace', role: 'Advisor', skills: [], active: false },
    ];
    const c = lists({ team: people, tags: ['b', 'a', 'b'] });
    expect(await html('{% for p in team %}{{ p.name }} ({{ p.role }}): {{ p.skills | join: " + " }}{% unless forloop.last %}; {% endunless %}{% endfor %}', c)).toBe('Ada (Lead): math + engines; Grace (Advisor): ');
    expect(await html('{% for p in team %}{% if p.active %}{{ p.name }}{% endif %}{% endfor %}', c)).toBe('Ada');
    expect(await html('{{ team.size }} {{ team.first.name }} {{ team.last.name }} {{ team.0.role }} {{ tags | size }}', c)).toBe('2 Ada Grace Lead 3');
    expect(await html('{{ tags | sort | join: "," }} {{ tags | uniq | join: "," }} {{ tags | reverse | join }} {{ tags | first }}', c)).toBe('a,b,b b,a b a b b');
    expect(await html('{% for p in team | sort %}{% endfor %}', c).catch((e) => e.message)).toBe('Cannot read “{% for p in team | sort %}” (write {% for item in list %}).');
    expect(await html('{% assign byName = team | sort: "name" %}{% for p in byName reversed %}{{ p.name }} {% endfor %}', c)).toBe('Grace Ada ');
    expect(await html('{{ "Café & Co: News!" | slugify }}', c)).toBe('cafe-co-news');
  });

  test('assign and split, contains, comparisons, empty', async () => {
    const c = lists({ tags: ['news', 'updates'] }, { count: '3' }, { list: 'a, b, c', n: '10' });
    expect(await html('{% assign parts = include.list | split: ", " %}{% for p in parts %}[{{ p }}]{% endfor %} {{ parts.size }}', c)).toBe('[a][b][c] 3');
    expect(await html('{% if tags contains "news" %}N{% endif %}{% if tags contains "old" %}O{% endif %}{% if include.list contains "b, c" %}S{% endif %}', c)).toBe('NS');
    expect(await html('{% if tags.size > 1 %}many{% endif %}{% if include.n >= 9 %} big{% endif %}{% if count < include.n %} less{% endif %}', c)).toBe('many big less');
    expect(await html('{% if missing == empty %}E{% endif %}{% if tags == empty %}no{% endif %}{% if include.blank == blank %}B{% endif %}', lists({ tags: ['x'] }, {}, { blank: '  ' }))).toBe('EB');
    expect(await html('{% for t in tags %}{% assign last = t %}{% endfor %}{{ last }}', c)).toBe('updates');
    expect(await renderComponent('{{ include.list | split }}', c)).toEqual({ error: 'The filter “split” needs a separator, as in split: ", ".' });
    expect(await html('{% if include.flag == false %}F{% endif %}{% if missing == false %}M{% endif %}', lists({}, {}, { flag: false }))).toBe('F');
  });

  test('white space control and lists passed to nested components', async () => {
    const c = lists({ tags: ['news', 'updates'] }, { tags: 'news, updates' }, {}, { 'tag.html': '<b>{{ include.name }}</b>', 'list.html': '{{ include.items | join: "+" }}' });
    expect(await html('<ul>\n  {%- for t in tags %}\n  <li>{{ t }}</li>\n  {%- endfor %}\n</ul>', c)).toBe('<ul>\n  <li>news</li>\n  <li>updates</li>\n</ul>');
    expect(await html('{{- "a" -}}  \n  b', c)).toBe('ab');
    expect(await html('{% for t in tags %}{% include tag.html name=t %}{% endfor %}', c)).toBe('<b>news</b><b>updates</b>');
    expect(await html('{% include list.html items=tags %}', c)).toBe('news+updates');
    expect(parseIncludeArgs(' items=tags label=tags.size other=x', { tags: 'a, b' }, { tags: ['a', 'b'] })).toEqual({ items: ['a', 'b'], label: 'tags.size', other: 'x' });
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

  test('front matter lists in components; a child document overrides a list', async () => {
    const tagList = {
      'tags.html': '<ul class="tags">{% for tag in tags %}<li>{{ tag }}</li>{% endfor %}</ul>',
      'people.html': '{% for p in include.people %}{{ p.name }}{% unless forloop.last %}, {% endunless %}{% endfor %}',
    };
    const files = {
      [`${P}/main.md`]: '---\ntitle: T\ntags:\n  - news\n  - updates\n  - jekyll\nteam:\n  - name: Ada\n  - name: Grace\n---\nTags: {{tags}}\n\n{% include tags.html %}\n\nBy {% include people.html people=team %}.\n\n/child.md\n',
      [`${P}/child.md`]: '---\ntags: just one\n---\n{% include tags.html %}\n',
    };
    const doc = await composeDocument(host(files, tagList), { docPath: `${P}/main.md`, projectRoot: P, baseScope: {} });
    expect(doc.warnings).toEqual([]);
    expect(doc.html).toContain('Tags: news, updates, jekyll');
    expect(doc.html).toContain('<ul class="tags"><li>news</li><li>updates</li><li>jekyll</li></ul>');
    expect(doc.html).toContain('By Ada, Grace.');
    expect(doc.html).toContain('<ul class="tags"><li>just one</li></ul>');
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
