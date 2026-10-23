import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { componentSpec, includeTag, initialValues, labelFromName, missingRequired, readIncludeTag } from '../src/componentSpec';
import { parseIncludeLine } from '../src/components';

const seed = (name: string) => readFileSync(new URL(`../../../resources/seed/Components/${name}`, import.meta.url), 'utf8');

describe('component specs', () => {
  test('the built-in figure describes its fields', () => {
    const spec = componentSpec('figure.html', seed('figure.html'));
    expect(spec.label).toBe('Figure');
    expect(spec.problem).toBeUndefined();
    expect(spec.page).toBe(false);
    expect(spec.params.map((p) => [p.name, p.type, !!p.required])).toEqual([
      ['src', 'file', true],
      ['caption', 'textarea', false],
      ['alt', 'text', false],
      ['size', 'choice', false],
      ['align', 'choice', false],
    ]);
    expect(spec.params.find((p) => p.name === 'size')).toMatchObject({ label: 'Width', options: ['full', 'wide', 'half', 'third', 'quarter', 'small'], default: 'full' });
    expect(spec.params[0].accept).toContain('svg');
    expect(componentSpec('footer.html', seed('footer.html')).page).toBe(true);
  });

  test('fields read from a template without a description block', () => {
    const src = `{% comment %}
  A table of plants. Pass a list.

  More notes.
{% endcomment %}
<table class="{{ include.style | default: 'plain' }}">{% for name in include.plants %}<tr><td>{{ name }}</td></tr>{% endfor %}</table>
{% if include.striped %}<style>…</style>{% endif %}
<p>{{ include.note | markdownify }}</p>
{% include row.html cells=include.cells %}`;
    const spec = componentSpec('plant-list.html', src);
    expect(spec.label).toBe('Plant list');
    expect(spec.description).toBe('A table of plants. Pass a list.');
    expect(spec.params.map((p) => [p.name, p.type, p.default, p.inferred])).toEqual([
      ['style', 'text', 'plain', true],
      ['plants', 'variable', undefined, true],
      ['striped', 'boolean', undefined, true],
      ['note', 'textarea', undefined, true],
      ['cells', 'text', undefined, true],
    ]);
  });

  test('description blocks: mapping form, undocumented fields added, mistakes reported', () => {
    const src = `{% comment %}
---
label: Callout
params:
  type: { type: choice, options: "note, warning", default: note }
  text: { type: textarea, required: true }
  bad: { type: colour }
---
{% endcomment %}
<aside class="{{ include.type }} {{ include.extra }}">{{ include.text | markdownify }}</aside>`;
    const spec = componentSpec('callout.html', src);
    expect(spec.params.map((p) => [p.name, p.type])).toEqual([
      ['type', 'choice'],
      ['text', 'textarea'],
      ['extra', 'text'],
    ]);
    expect(spec.params[0].options).toEqual(['note', 'warning']);
    expect(spec.problem).toBe('In the description block: “bad” has the type “colour”; use text, textarea, choice, boolean, file, variable.');
    const broken = componentSpec('x.html', '{% comment %}\n---\nparams: [\n---\n{% endcomment %}{{ include.a }}');
    expect(broken.problem).toMatch(/^The description block is not valid YAML/);
    expect(broken.params.map((p) => p.name)).toEqual(['a']);
  });

  test('include tags: built from the dialog, read back for editing', () => {
    const spec = componentSpec('figure.html', seed('figure.html'));
    const values = { ...initialValues(spec), src: 'images/plan.png', caption: 'The "site"\nplan', size: 'half' };
    const tag = includeTag(spec, values);
    expect(tag).toBe('{% include figure.html src="images/plan.png" caption="The \\"site\\" plan" size="half" %}');
    expect(parseIncludeLine(tag)?.name).toBe('figure.html');
    const read = readIncludeTag(tag)!;
    expect(read.name).toBe('figure.html');
    expect(read.values.caption).toEqual({ value: 'The "site" plan', quoted: true });
    const again = initialValues(spec, read.values);
    expect(includeTag(spec, again)).toBe(tag);
    expect(missingRequired(spec, initialValues(spec))).toEqual(['Image']);
    expect(missingRequired(spec, values)).toEqual([]);
  });

  test('variables unquoted, on/off fields only when not the default, unknown parameters kept', () => {
    const spec = componentSpec('plant-list.html', '{% for n in include.plants %}{% endfor %}{% if include.striped %}{% endif %}{{ include.folder | default: "Plants" }}');
    expect(includeTag(spec, { plants: 'plants', striped: false, folder: '' })).toBe('{% include plant-list.html plants=plants %}');
    expect(includeTag(spec, { plants: 'garden.plants', striped: true, folder: 'Data/Plants' })).toBe('{% include plant-list.html plants=garden.plants striped=true folder="Data/Plants" %}');
    expect(includeTag(spec, { plants: 'not a name', striped: false, folder: '' })).toBe('{% include plant-list.html plants="not a name" %}');
    const read = readIncludeTag('{% include plant-list.html plants=plants colour="green" size=half %}')!;
    expect(includeTag(spec, initialValues(spec, read.values), read.values)).toBe('{% include plant-list.html plants=plants colour="green" size=half %}');
    expect(readIncludeTag('not a tag')).toBeNull();
  });

  test('labels from names', () => {
    expect(labelFromName('footer-logo')).toBe('Footer logo');
    expect(labelFromName('plant_list.html')).toBe('Plant list');
  });
});
