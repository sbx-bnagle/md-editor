import { describe, expect, test } from 'vitest';
import { join, relative, dirname, normalize, isInside, extname } from '../src/paths';
import { splitFrontMatter } from '../src/frontmatter';
import { substituteVariables, flattenVariables, cssIdent } from '../src/variables';
import { parseContentBlock } from '../src/contentBlocks';
import { parseCsv } from '../src/csv';
import { curlyQuote, isInsideHtmlTag, isInsideCodeSpan, isInsideVariable, smartenMarkdown } from '../src/smartQuotes';
import { computeDiff } from '../src/diff';
import { validateName } from '../src/library';

describe('paths', () => {
  test('join and normalize', () => {
    expect(join('/a/b', '../c', './d.md')).toBe('/a/c/d.md');
    expect(normalize('/a//b/./c/..')).toBe('/a/b');
    expect(dirname('/a/b/c.md')).toBe('/a/b');
    expect(relative('/lib/p', '/lib/p/x/y.md')).toBe('x/y.md');
    expect(isInside('/lib/p/x', '/lib/p')).toBe(true);
    expect(isInside('/lib/px', '/lib/p')).toBe(false);
    expect(extname('/a/B.MD')).toBe('.md');
  });
});

describe('front matter', () => {
  test('parses YAML and reports body offset', () => {
    const fm = splitFrontMatter('---\ntitle: Report\ndate: 2026-10-20\n---\n# Hi\n');
    expect(fm.present).toBe(true);
    expect(fm.data).toEqual({ title: 'Report', date: '2026-10-20' });
    expect(fm.body).toBe('# Hi\n');
    expect(fm.bodyLine).toBe(4);
  });
  test('no front matter', () => {
    expect(splitFrontMatter('# Hi').present).toBe(false);
  });
  test('invalid YAML reports error', () => {
    expect(splitFrontMatter('---\n: : :\n  - x\n---\n').error).toBeTruthy();
  });
});

describe('variables', () => {
  test('substitutes outside code, honours escapes, reports missing', () => {
    const src = 'Hi {{name}} `{{name}}` \\{{name}} {{ nope }}\n```\n{{name}}\n```\n{{name}}';
    const r = substituteVariables(src, { name: 'Ada' });
    expect(r.text).toBe('Hi Ada `{{name}}` {{name}} {{ nope }}\n```\n{{name}}\n```\nAda');
    expect(r.missing).toEqual(['nope']);
  });
  test('flattens nested values', () => {
    expect(flattenVariables({ client: { name: 'Acme' }, n: 3, tags: ['a', 'b'], empty: null })).toEqual({
      'client.name': 'Acme',
      n: '3',
      tags: 'a, b',
      empty: '',
    });
    expect(cssIdent('Client Name')).toBe('Client-Name');
    expect(cssIdent('client.name')).toBe('client-name');
  });
});

describe('content blocks', () => {
  test('spec examples', () => {
    expect(parseContentBlock('/Flowchart.png "Engineering Flowchart"')).toMatchObject({ target: '/Flowchart.png', title: 'Engineering Flowchart', kind: 'image' });
    expect(parseContentBlock("/Savings Account.csv 'Recent Transactions'")).toMatchObject({ target: '/Savings Account.csv', title: 'Recent Transactions', kind: 'table' });
    expect(parseContentBlock('/Example.swift')).toMatchObject({ kind: 'code', language: 'swift' });
    expect(parseContentBlock('/Lorem Ipsum.txt')).toMatchObject({ kind: 'markdown', target: '/Lorem Ipsum.txt' });
    expect(parseContentBlock('http://example.com/minard.jpg (Napoleon’s campaign)')).toMatchObject({ online: true, title: 'Napoleon’s campaign' });
    expect(parseContentBlock('   /Indented.md')).toMatchObject({ target: '/Indented.md' });
  });
  test('relative forms used by iA Writer drag and drop', () => {
    expect(parseContentBlock('../../tasks/plant/cutback.md')).toMatchObject({ target: '../../tasks/plant/cutback.md', kind: 'markdown' });
    expect(parseContentBlock('./images/a b.jpg')).toMatchObject({ target: './images/a b.jpg', kind: 'image' });
  });
  test('non-blocks', () => {
    expect(parseContentBlock('Some /path/file.md in prose')).toBeNull();
    expect(parseContentBlock('    /four-spaces.md')).toBeNull();
    expect(parseContentBlock('// comment.js')).toBeNull();
    expect(parseContentBlock('/no-extension')).toBeNull();
    expect(parseContentBlock('/file.md trailing words')).toBeNull();
  });
});

describe('csv', () => {
  test('quotes, escaped quotes, newlines in fields, semicolons', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCsv('a;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n"multi\nline",2')).toEqual([['a', 'b'], ['multi\nline', '2']]);
  });
});

describe('smart quotes', () => {
  test('typing rules', () => {
    expect(curlyQuote('"', undefined)).toBe('“');
    expect(curlyQuote('"', ' ')).toBe('“');
    expect(curlyQuote('"', 'd')).toBe('”');
    expect(curlyQuote("'", 'n')).toBe('’');
    expect(curlyQuote("'", '(')).toBe('‘');
  });
  test('contexts where quotes stay straight', () => {
    expect(isInsideHtmlTag('text <a href=')).toBe(true);
    expect(isInsideHtmlTag('text <a href="x">link')).toBe(false);
    expect(isInsideHtmlTag('if a < b')).toBe(false);
    expect(isInsideCodeSpan('see `x = ')).toBe(true);
    expect(isInsideCodeSpan('see `x` and ')).toBe(false);
    expect(isInsideVariable('{{ name')).toBe(true);
  });
  test('bulk conversion skips code, tags, variables, content blocks and front matter', () => {
    const src = '---\ntitle: "Report"\n---\nShe said "hi" and it\'s `x = "y"` <a href="u">"go"</a>\n```\n"code"\n```\n/file.md "Title"\n{{ "v" }}';
    expect(smartenMarkdown(src, true)).toBe(
      '---\ntitle: "Report"\n---\nShe said “hi” and it’s `x = "y"` <a href="u">“go”</a>\n```\n"code"\n```\n/file.md "Title"\n{{ "v" }}',
    );
  });
});

describe('diff', () => {
  test('hunks with word detail', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\n';
    const after = 'a\nb\nc\nD changed\ne\nf\ng\nh\ni\nj\n';
    const hunks = computeDiff(before, after, 1);
    expect(hunks.length).toBe(2);
    const del = hunks[0].lines.find((l) => l.type === 'del')!;
    expect(del.text).toBe('d');
    expect(hunks[1].lines.at(-1)).toMatchObject({ type: 'add', text: 'j' });
  });
});

describe('names', () => {
  test('validation', () => {
    expect(validateName('Report 2026')).toBeNull();
    expect(validateName('a/b')).toBeTruthy();
    expect(validateName('.hidden')).toBeTruthy();
    expect(validateName(' pad')).toBeTruthy();
  });
});
