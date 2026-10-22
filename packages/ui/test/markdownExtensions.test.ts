import { describe, expect, test } from 'vitest';
import { GFM, parser } from '@lezer/markdown';
import { HeaderlessTable } from '../src/editor/headerlessTables';

const md = parser.configure([GFM, HeaderlessTable]);
const nodes = (text: string) => {
  const out: string[] = [];
  md.parse(text).iterate({ enter: (n) => void out.push(`${n.name}@${n.from}`) });
  return out;
};

describe('editor: tables that start with a separator row', () => {
  test('are tables, with rows and cells', () => {
    const n = nodes('|:--|:--|\n| a | b |\n| c | d |\n\nAfter.\n');
    expect(n).toContain('Table@0');
    expect(n).toContain('TableDelimiter@0');
    expect(n.filter((x) => x.startsWith('TableRow'))).toEqual(['TableRow@10', 'TableRow@20']);
    expect(n.filter((x) => x.startsWith('TableCell'))).toHaveLength(4);
    expect(n).toContain('Paragraph@31');
  });

  test('standard markdown keeps its meaning', () => {
    expect(nodes('| A | B |\n|---|---|\n| 1 | 2 |\n')).toContain('TableHeader@0');
    expect(nodes('Some text\n|---|---|\n| 1 | 2 |\n')).not.toContain('Table@0');
    expect(nodes('|---|---|\n')).not.toContain('Table@0');
    expect(nodes('Title\n---\n')).toContain('SetextHeading2@0');
  });
});

describe('editor: +++ page breaks', () => {
  test('a PageBreak node, which ends a paragraph', async () => {
    const { PageBreak } = await import('../src/editor/pageBreaks');
    const md = parser.configure([GFM, PageBreak]);
    const names = (text: string) => {
      const out: string[] = [];
      md.parse(text).iterate({ enter: (n) => void out.push(`${n.name}@${n.from}`) });
      return out;
    };
    expect(names('One.\n+++\nTwo.\n')).toEqual(expect.arrayContaining(['Paragraph@0', 'PageBreak@5', 'Paragraph@9']));
    expect(names('```\n+++\n```\n')).not.toContain('PageBreak@4');
    expect(names('a +++ b\n').some((n) => n.startsWith('PageBreak'))).toBe(false);
  });
});
