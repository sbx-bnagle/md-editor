import { describe, expect, test } from 'vitest';
import { isContentBlockLine } from '../src/contentBlocks';
import { splitFrontMatter } from '../src/frontmatter';
import { mapPreviewEdit } from '../src/previewEdit';
import { createMarkdown, shiftHeadingLevels, type MarkdownEnv } from '../src/render/markdown';
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
  // As the preview reads it: a <br> is the line break character.
  return decode(m[2].replace(/<br\s*\/?>/gi, '\u2028').replace(/<[^>]+>/g, ''));
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

/** Text of a cell of the table row with data-src-line=line, as the preview shows it. */
function shownCell(file: string, line: number, cell: number): string {
  const env: MarkdownEnv = { baseDir: '/', assetUrl: (p) => p, lineOffset: splitFrontMatter(file).bodyLine };
  const html = md.render(splitFrontMatter(file).body, env as unknown as Record<string, unknown>);
  const row = new RegExp(`<tr\\b[^>]*data-src-line="${line}"[^>]*>([\\s\\S]*?)</tr>`).exec(html);
  if (!row) throw new Error(`no row on line ${line}:\n${html}`);
  const cells = [...row[1].matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/g)].map((m) => decode(m[2].replace(/<[^>]+>/g, '')));
  return cells[cell] ?? '';
}

/** Edits a cell's shown text, maps it back, and checks what the new file shows in that cell. */
function editCell(file: string, line: number, cell: number, change: (text: string) => string, expected?: string) {
  const before = shownCell(file, line, cell);
  const after = change(before);
  const r = mapPreviewEdit(file, { line, cell, before, after });
  if (!r || 'error' in r) return { error: r ? r.error : null, file };
  const next = file.slice(0, r.from) + r.insert + file.slice(r.to);
  expect(shownCell(next, line, cell)).toBe(expected ?? after);
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

  test('table cells: header and body, formatting, escaped pipes, empty and missing cells', () => {
    const table = '| Name | Soil |\n| --- | --- |\n| Echinacea | dry |\n';
    expect(editCell(table, 2, 1, (t) => t.replace('dry', 'well drained')).file).toBe('| Name | Soil |\n| --- | --- |\n| Echinacea | well drained |\n');
    expect(editCell(table, 0, 0, () => 'Plant').file).toBe('| Plant | Soil |\n| --- | --- |\n| Echinacea | dry |\n');
    // Typed text: a pipe is escaped; nothing counts as the start of a line.
    expect(editCell(table, 2, 1, () => 'wet|dry').file).toContain('| Echinacea | wet\\|dry |');
    expect(editCell(table, 2, 1, () => '# 1').file).toContain('| Echinacea | # 1 |');
    expect(editCell('| A |\n|---|\n| **bol** and `x` |\n', 2, 0, (t) => t.replace('bol', 'bold')).file).toContain('| **bold** and `x` |');
    expect(editCell('| A |\n|---|\n| **bol** and `x` |\n', 2, 0, (t) => t.replace('x', 'a|b')).file).toContain('`a\\|b`');
    // An escaped pipe in the source is one character of the cell.
    const piped = '| A | B |\n|---|---|\n| a \\| b | c |\n';
    expect(editCell(piped, 2, 0, (t) => t.replace('b', 'B')).file).toContain('| a \\| B | c |');
    expect(editCell(piped, 2, 0, (t) => t.replace(' | ', ' or ')).file).toContain('| a or b | c |');
    expect(editCell(piped, 2, 1, (t) => t.replace('c', 'C')).file).toContain('| a \\| b | C |');
    // Empty cells, and cells a short row does not have.
    expect(editCell('| A | B |\n|---|---|\n| a |  |\n', 2, 1, () => 'x').file).toContain('| a | x |');
    expect(editCell('| A | B |\n|---|---|\n| a | |\n', 2, 1, () => 'x').file).toContain('| a | x |');
    expect(editCell('| A | B |\n|---|---|\n| a ||\n', 2, 1, () => 'x').file).toContain('| a |x|');
    expect(editCell('| A | B | C |\n|---|---|---|\n| a |\n', 2, 2, () => 'z').file).toContain('| a | | z |');
    expect(editCell('A | B | C\n--|--|--\na | b\n', 2, 2, () => 'z').file).toContain('a | b | z');
    // Rows without a header (the app's extension), and front matter before the table.
    expect(editCell('|:--|:--|\n| a | b |\n', 1, 1, () => 'c').file).toBe('|:--|:--|\n| a | c |\n');
    expect(editCell('---\ntitle: T\n---\n\n| A |\n|---|\n| old |\n', 6, 0, () => 'new').file).toContain('| new |');
    // A table inside a block quote is not mapped; nothing is written on a guess.
    expect(mapPreviewEdit('> | A |\n> |---|\n> | b |\n', { line: 2, cell: 0, before: 'b', after: 'c' })).toMatchObject({ error: expect.stringMatching(/could not be matched/) });
    expect(mapPreviewEdit(table, { line: 2, cell: 1, before: 'damp', after: 'wet' })).toMatchObject({ error: expect.stringMatching(/out of date/) });
  });

  test('line breaks: <br> in headings (typed as U+2028 in the preview), hard breaks in paragraphs', () => {
    expect(edit('## Planting guide<br>Spring 2026\n', 0, (t) => t.replace('Spring', 'Autumn')).file).toBe('## Planting guide<br>Autumn 2026\n');
    expect(edit('## Planting guide Spring\n', 0, (t) => t.replace('guide ', 'guide\u2028')).file).toBe('## Planting guide<br>Spring\n');
    expect(edit('## Planting guide\n', 0, (t) => `${t}\u2028Spring`).file).toBe('## Planting guide<br>Spring\n');
    // Deleting the break removes the whole <br>.
    expect(edit('## A<br>B\n', 0, (t) => t.replace(/\s*\u2028/, ' ')).file).toBe('## A B\n');
    expect(edit('## A <br/> B\n', 0, (t) => t.replace(/\s*\u2028\s*/, '')).file).toBe('## AB\n');
    expect(edit('one\\\ntwo\n', 0, (t) => t.replace('two', 'three')).file).toBe('one\\\nthree\n');
    expect(edit('one  \ntwo\n', 0, (t) => t.replace(/\s*\u2028\s*/, ' ')).file).toBe('one two\n');
    // A break typed at the end of code goes after it; inside code it is refused.
    expect(edit('## Run `x`\n', 0, (t) => t.replace('x', 'x\u2028y')).file).toBe('## Run `x`<br>y\n');
    expect(edit('## Run `xy`\n', 0, (t) => t.replace('xy', 'x\u2028y')).error).toMatch(/line break/);
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

describe('headings tagged from H1', () => {
  test('aria-level shifts every heading, never above 1; the elements stay', () => {
    const html = '<h2 id="a">A</h2><p>x</p><h3>B</h3><h1>C</h1><header>h</header><h4\nclass="d">D</h4>';
    expect(shiftHeadingLevels(html, 1)).toBe('<h2 aria-level="1" id="a">A</h2><p>x</p><h3 aria-level="2">B</h3><h1 aria-level="1">C</h1><header>h</header><h4 aria-level="3"\nclass="d">D</h4>');
    expect(shiftHeadingLevels(html, 0)).toBe(html);
  });

  test('a heading with <br>: a space before it, and read as a space in the id and the outline', () => {
    const md2 = createMarkdown();
    const env: MarkdownEnv = { baseDir: '/', assetUrl: (p) => p, outline: [] };
    const html = md2.render('## Planting guide<br>Spring\n\n### Soil\n', env as unknown as Record<string, unknown>);
    expect(html).toContain('<h2 data-src-line="0" id="planting-guide-spring">Planting guide <br>Spring</h2>');
    expect(env.outline).toEqual([
      { level: 2, line: 0, text: 'Planting guide Spring' },
      { level: 3, line: 2, text: 'Soil' },
    ]);
  });
});
