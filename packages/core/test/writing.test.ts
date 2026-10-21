import { describe, expect, test } from 'vitest';
import { maskNonProse, headingRanges } from '../src/prose';
import { checkStyle, numberToWords, BASES } from '../src/style/rules';
import { parseStyleGuide, describeStyleGuide } from '../src/style/guide';
import { readability, syllables } from '../src/readability';
import { analyzeHeadline } from '../src/headline';
import { parseReview, locateQuotes, insertBlocks, parseHeadlines, extractJson } from '../src/ai';
import { normalizePreferences, type Preferences } from '../src/prefs';

const fix = (text: string, issues: ReturnType<typeof checkStyle>) => {
  let out = text;
  for (const i of [...issues].reverse()) if (i.suggestions.length) out = out.slice(0, i.from) + i.suggestions[0] + out.slice(i.to);
  return out;
};

describe('prose masking', () => {
  test('keeps length and blanks non-prose', () => {
    const src = '---\ntitle: A\n---\nSee `code` and <b>bold</b> at https://x.y {{v}}.\n```\nfenced\n```\n/file.md\n---\n';
    const m = maskNonProse(src);
    expect(m.length).toBe(src.length);
    expect(m.split('\n')[3]).toBe(`See        and    bold     at ${' '.repeat(17)}.`);
    expect(m).not.toContain('fenced');
    expect(m).not.toContain('file.md');
    expect(m).not.toContain('title');
  });
  test('headings', () => {
    expect(headingRanges('# One\n\ntext\n## Two Words ##\n').map((h) => [h.level, h.text])).toEqual([
      [1, 'One'],
      [2, 'Two Words'],
    ]);
  });
});

describe('style rules', () => {
  test('serial comma required and omitted', () => {
    const t = 'We sell apples, pears and plums. However, John and Mary left.';
    const req = checkStyle(t, { 'serial-comma': 'required' });
    expect(req.length).toBe(1);
    expect(fix(t, req)).toBe('We sell apples, pears, and plums. However, John and Mary left.');
    const omit = checkStyle('Red, white, and blue.', { 'serial-comma': 'omit' });
    expect(fix('Red, white, and blue.', omit)).toBe('Red, white and blue.');
  });
  test('numbers', () => {
    expect(fix('We have 3 cats, 12 dogs, 5% growth, and May 4 off.', checkStyle('We have 3 cats, 12 dogs, 5% growth, and May 4 off.', { numbers: 'spell-1-9' }))).toBe(
      'We have three cats, 12 dogs, 5% growth, and May 4 off.',
    );
    expect(fix('About 42 people.', checkStyle('About 42 people.', { numbers: 'spell-0-100' }))).toBe('About forty-two people.');
    expect(fix('Across three departments and one team.', checkStyle('Across three departments and one team.', { numbers: 'numerals' }))).toBe('Across 3 departments and one team.');
    expect(numberToWords(100)).toBe('one hundred');
  });
  test('dashes, ranges, quotes, spelling, units, times, ampersand', () => {
    expect(fix('A — B', checkStyle('A — B', { 'em-dash': 'closed' }))).toBe('A—B');
    expect(fix('A—B', checkStyle('A—B', { 'em-dash': 'spaced' }))).toBe('A — B');
    expect(fix('8-24 weeks and 8 – 24 days, not 2026-10-20', checkStyle('8-24 weeks and 8 – 24 days, not 2026-10-20', { 'range-dash': 'en-closed' }))).toBe('8–24 weeks and 8–24 days, not 2026-10-20');
    expect(fix('She said "hi"', checkStyle('She said "hi"', { quotes: 'curly' }))).toBe('She said “hi”');
    expect(fix('He said “go”.', checkStyle('He said “go”.', { 'quote-style': 'single' }))).toBe('He said ‘go’.');
    expect(fix('He said “go”, then left.', checkStyle('He said “go”, then left.', { 'comma-in-quotes': 'inside' }))).toBe('He said “go,” then left.');
    expect(fix('Their neighbours’ colourful behaviour; an organism; organisation.', checkStyle('Their neighbours’ colourful behaviour; an organism; organisation.', { spelling: 'us' }))).toBe(
      'Their neighbors’ colorful behavior; an organism; organization.',
    );
    expect(fix('The analysis will analyze color.', checkStyle('The analysis will analyze color.', { spelling: 'oxford' }))).toBe('The analysis will analyse colour.');
    expect(fix('Leave 7 mm at 9 AM & stop', checkStyle('Leave 7 mm at 9 AM & stop', { units: 'closed', times: 'closed', ampersand: 'avoid' }))).toBe('Leave 7mm at 9am and stop');
    expect(fix('At 9am today.', checkStyle('At 9am today.', { times: 'periods' }))).toBe('At 9 a.m. today.');
  });
  test('headings, double spaces, repeated words, wordy', () => {
    const t = '## How To Write A Proposal\n\nEnd.  Next the the line, in order to win.';
    const out = fix(t, checkStyle(t, { 'heading-case': 'sentence', 'double-space': 'flag', 'repeated-words': 'flag', wordy: 'flag' }));
    expect(out).toBe('## How to Write a Proposal\n\nEnd. Next the line, to win.');
  });
  test('no issues inside code or HTML, or in the gaps they leave', () => {
    expect(checkStyle('`a — b` <a title="x — y">', { 'em-dash': 'closed', quotes: 'curly' })).toEqual([]);
    expect(checkStyle('straight: <span title="x">hover</span>, and in code: `print("hi")`. Done', BASES.ap.settings)).toEqual([]);
  });
});

describe('style guides', () => {
  test('base plus overrides and custom rules', () => {
    const g = parseStyleGuide('house', '---\nbase: ap\nrules:\n  serial-comma: required\nreplace:\n  - use: toward\n    not: [towards]\navoid:\n  - phrase: utilize\n    suggest: use\nreading-grade: 10\n---\nKeep it plain.\n');
    expect(g.errors).toEqual([]);
    expect(g.settings['serial-comma']).toBe('required');
    expect(g.settings.numbers).toBe(BASES.ap.settings.numbers);
    expect(g.readingGrade).toBe(10);
    expect(g.notes).toBe('Keep it plain.');
    const issues = checkStyle('Walk towards it and utilize tools.', g.settings, g.custom);
    expect(fix('Walk towards it and utilize tools.', issues)).toBe('Walk toward it and use tools.');
    expect(describeStyleGuide(g)).toContain('Serial (Oxford) comma: Comma before and/or');
  });
  test('reports bad rules', () => {
    expect(parseStyleGuide('x', '---\nbase: mla\nrules:\n  numbers: roman\n---\n').errors.length).toBe(2);
  });
});

describe('readability', () => {
  test('syllables', () => {
    expect(syllables('cat')).toBe(1);
    expect(syllables('reading')).toBe(2);
    expect(syllables('readability')).toBe(5);
  });
  test('easy and hard text', () => {
    const easy = readability('The cat sat on the mat. The dog ran to the park. We had fun.');
    expect(easy.sentences).toBe(3);
    expect(easy.fleschKincaidGrade).toBeLessThan(3);
    const hard = readability('Notwithstanding considerable organizational complexity, interdepartmental collaboration necessitates comprehensive documentation of institutional responsibilities.');
    expect(hard.fleschKincaidGrade).toBeGreaterThan(16);
    expect(hard.sentenceGrades[0].from).toBe(0);
  });
  test('ignores headings, code and list markers', () => {
    const r = readability('# A heading here\n\n- First item\n- Second item\n\n```\ncode code code\n```\n');
    expect(r.sentences).toBe(2);
    expect(r.words).toBe(4);
  });
});

describe('headlines', () => {
  test('scores and notes', () => {
    const good = analyzeHeadline('## 5 ways to cut your onboarding time');
    expect(good.engagement).toBeGreaterThan(70);
    expect(good.notes.some((n) => n.text.includes('number'))).toBe(true);
    const vague = analyzeHeadline('Leveraging Innovative Solutions For Various Stakeholder Synergies Across The Enterprise Ecosystem');
    expect(vague.clarity).toBeLessThan(40);
  });
});

describe('AI reply parsing', () => {
  test('review JSON and quote location', () => {
    const issues = parseReview('```json\n{"issues":[{"quote":"very \\"unique\\"","message":"Hype","suggestion":"unusual"}]}\n```');
    expect(issues).toHaveLength(1);
    expect(locateQuotes('It is very “unique” indeed.', issues)).toEqual([{ ...issues[0], from: 6, to: 19 }]);
    expect(parseReview('no json')).toEqual([]);
    expect(extractJson('text {"a":1} more')).toEqual({ a: 1 });
  });
  test('insert blocks and headlines', () => {
    expect(insertBlocks('Try:\n```insert\nNew text.\n```\nor\n```insert\nOther\n```')).toEqual(['New text.', 'Other']);
    expect(parseHeadlines('{"alternatives":[{"text":"A","why":"B"}]}')).toEqual([{ text: 'A', why: 'B' }]);
  });
});

describe('preferences', () => {
  test('raises the old default editor size and keeps a size the user chose', () => {
    expect(normalizePreferences({ editorFontSize: 15 } as Partial<Preferences>).editorFontSize).toBe(18);
    expect(normalizePreferences({ editorFontSize: 16 } as Partial<Preferences>).editorFontSize).toBe(16);
    expect(normalizePreferences({ version: 2, editorFontSize: 15 } as Partial<Preferences>).editorFontSize).toBe(15);
    expect(normalizePreferences(undefined).editorFontSize).toBe(18);
  });
});
