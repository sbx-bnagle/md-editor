import { describe, expect, test } from 'vitest';
import { isContentBlockLine } from '../src/contentBlocks';
import { splitFrontMatter } from '../src/frontmatter';
import { mapPreviewEdit } from '../src/previewEdit';
import { createMarkdown, type MarkdownEnv } from '../src/render/markdown';
import { substituteVariables } from '../src/variables';

const md = createMarkdown();

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Text of the element with data-src-line=line, as the preview shows it (tags stripped). */
function shown(file: string, line: number, vars: Record<string, string> = {}): string {
  const fm = splitFrontMatter(file);
  const env: MarkdownEnv = { baseDir: '/', assetUrl: (p) => p, lineOffset: fm.bodyLine };
  // Content block lines render on their own (compose); here they are left out.
  const body = fm.body.split('\n').map((l) => (isContentBlockLine(l) ? '' : l)).join('\n');
  const html = md.render(substituteVariables(body, vars).text, env as unknown as Record<string, unknown>);
  const m = new RegExp(`<(p|h[1-6]|li)\\b[^>]*data-src-line="${line}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  if (!m) throw new Error(`no element on line ${line}:\n${html}`);
  return decode(m[2].replace(/<[^>]+>/g, ''));
}

/** Edits the shown text, maps it back, and returns the new file and what it shows. */
function edit(file: string, line: number, change: (text: string) => string, vars: Record<string, string> = {}, expected?: string) {
  const before = shown(file, line, vars);
  const after = change(before);
  const r = mapPreviewEdit(file, { line, before, after }, vars);
  if (!r || 'error' in r) return { error: r ? r.error : null, file };
  const next = file.slice(0, r.from) + r.insert + file.slice(r.to);
  expect(shown(next, line, vars).replace(/\s+/g, ' ').trim()).toBe((expected ?? after).replace(/\s+/g, ' ').trim());
  return { error: null, file: next };
}

describe('preview edits map to the markdown source', () => {
  test('plain text, headings, list items, quotes over several lines', () => {
    expect(edit('The quick brown fox.\n', 0, (t) => t.replace('quick', 'slow')).file).toBe('The slow brown fox.\n');
    expect(edit('## Old title ##\n', 0, (t) => t.replace('Old', 'New')).file).toBe('## New title ##\n');
    expect(edit('- one\n- two\n', 1, (t) => t.replace('two', 'three')).file).toBe('- one\n- three\n');
    expect(edit('> line one\n> line two\n', 0, (t) => t.replace('two', '2')).file).toBe('> line one\n> line 2\n');
    expect(edit('one\ntwo\n', 0, (t) => t.replace(/one\s+two/, 'one, two')).file).toBe('one,\ntwo\n');
  });

  test('front matter and content block lines keep line numbers', () => {
    const file = '---\ntitle: T\n---\n\n# {{title}}\n\nFirst.\n/pic.png\nSecond.\n';
    expect(edit(file, 8, (t) => t.replace('Second', 'Last'), { title: 'T' }).file).toContain('/pic.png\nLast.\n');
  });

  test('formatting: inside bold, links and code; new words go outside', () => {
    expect(edit('A **bol** move.\n', 0, (t) => t.replace('bol', 'bold')).file).toBe('A **bold** move.\n');
    expect(edit('See [the docs](http://x.com/a.html "Docs (old)") now.\n', 0, (t) => t.replace('docs', 'guide')).file).toBe(
      'See [the guide](http://x.com/a.html "Docs (old)") now.\n',
    );
    expect(edit('See [the docs](http://x.com/a.html) now.\n', 0, (t) => t.replace('docs now', 'docs page now')).file).toBe('See [the docs](http://x.com/a.html) page now.\n');
    expect(edit('Ends with **bold**\n', 0, (t) => `${t} and more`).file).toBe('Ends with **bold** and more\n');
    expect(edit('Run `npm test` now.\n', 0, (t) => t.replace('test', 'start')).file).toBe('Run `npm start` now.\n');
    expect(edit('Run `npm test` now.\n', 0, (t) => t.replace('test', 'te`st')).error).toMatch(/backtick/);
    expect(edit('foo **bar** baz\n', 0, (t) => t.replace('r b', 'X')).error).toMatch(/crosses formatting/);
    // The same deletion can be read as "ar b" or "bar "; the one that keeps the markup whole is used.
    expect(edit('foo **bar** baz\n', 0, (t) => t.replace('ar b', '')).file).toBe('foo baz\n');
    expect(edit('foo **bar** baz\n', 0, (t) => t.replace('bar ', '')).file).toBe('foo baz\n');
    expect(edit('a <b>bold</b> c\n', 0, (t) => t.replace('bold', 'big')).file).toBe('a <b>big</b> c\n');
    expect(edit('a <b>bold</b> c\n', 0, (t) => t.replace('a b', '')).error).toMatch(/inline HTML/);
  });

  test('typed text: escapes, quotes and dashes as the editor would write them', () => {
    expect(edit('Plain.\n', 0, (t) => t.replace('Plain', 'Plain *not bold* [x]')).file).toBe('Plain \\*not bold\\* \\[x\\].\n');
    expect(edit('Plain.\n', 0, (t) => t.replace('Plain', 'snake_case and _x_')).file).toBe('snake_case and \\_x\\_.\n');
    expect(edit('Plain.\n', 0, (t) => `# ${t}`).file).toBe('\\# Plain.\n');
    expect(edit('Plain.\n', 0, (t) => t.replace('.', ' "quoted" it\'s.'), {}, 'Plain “quoted” it’s.').file).toBe('Plain “quoted” it’s.\n');
    expect(edit('Pages 1--5.\n', 0, (t) => t.replace('5', '6')).file).toBe('Pages 1--6.\n');
    expect(edit('Wait.\n', 0, (t) => t.replace('.', ' -- no.'), {}, 'Wait – no.').file).toBe('Wait – no.\n');
    expect(edit('Fish &amp; chips\n', 0, (t) => t.replace('chips', 'fries')).file).toBe('Fish &amp; fries\n');
    expect(edit('A \\*star\\* here\n', 0, (t) => t.replace('here', 'there')).file).toBe('A \\*star\\* there\n');
  });

  test('variables and footnotes cannot be edited partly', () => {
    const vars = { client: 'Acme Corp' };
    expect(edit('Hello {{client}}.\n', 0, (t) => t.replace('Hello', 'Hi'), vars).file).toBe('Hi {{client}}.\n');
    expect(edit('Hello {{client}}.\n', 0, (t) => t.replace('Acme', 'Ajax'), vars).error).toMatch(/variable/);
    const fn = 'Text[^1] more.\n\n[^1]: Note.\n';
    expect(edit(fn, 0, (t) => t.replace('more', 'less')).file).toBe('Text[^1] less.\n\n[^1]: Note.\n');
    expect(edit(fn, 0, (t) => t.replace('[1]', '[2]')).error).toMatch(/footnote/);
    expect(edit(fn, 0, (t) => t.replace('t[1', 't [1')).file).toBe('Text [^1] more.\n\n[^1]: Note.\n');
  });

  test('stale or unknown blocks are refused', () => {
    expect(mapPreviewEdit('Current text.\n', { line: 0, before: 'Old text.', after: 'Old text!' })).toMatchObject({ error: expect.stringMatching(/out of date/) });
    expect(mapPreviewEdit('Text.\n', { line: 5, before: 'a', after: 'b' })).toMatchObject({ error: expect.stringMatching(/could not be matched/) });
    expect(mapPreviewEdit('Same.\n', { line: 0, before: 'Same.', after: 'Same. ' })).toBeNull();
  });
});

describe('author spans after an edit', () => {
  test('shift, split and attribute', async () => {
    const { spansAfterEdit } = await import('../src/annotations');
    const ai = { author: '&Claude', from: 10, to: 20 };
    expect(spansAfterEdit([ai], 0, 2, 5, null)).toEqual([{ author: '&Claude', from: 13, to: 23 }]);
    expect(spansAfterEdit([ai], 25, 30, 0, null)).toEqual([ai]);
    expect(spansAfterEdit([ai], 12, 15, 1, '@Brad')).toEqual([
      { author: '&Claude', from: 10, to: 12 },
      { author: '@Brad', from: 12, to: 13 },
      { author: '&Claude', from: 13, to: 18 },
    ]);
    expect(spansAfterEdit([ai], 5, 25, 0, null)).toEqual([]);
  });
});
