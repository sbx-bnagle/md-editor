import { describe, expect, test } from 'vitest';
import { Thesaurus, inflect, matchCase, thesaurusQuery, topSynonyms } from '../src/thesaurus';

// A miniature data file in the format written by scripts/build-thesaurus.mjs.
const DATA = [
  'MDETHES1',
  'S v use one\'s feet to advance\twalk\tb:2,n:1',
  'S v walk leisurely\tstroll|saunter\t',
  'S v change location\ttravel|go|move\t',
  'S n a motor vehicle with four wheels\tcar|automobile|auto\tb:4',
  'S n a self-propelled wheeled vehicle\tmotor vehicle\t',
  'S a accomplished rapidly\tquick|speedy\ts:6',
  'S a acting or moving rapidly\tfast\t',
  'S n a trip on foot\twalk|hike|tramp\t',
  'I walk\t0,7',
  'I stroll\t1',
  'I car\t3',
  'I quick\t5',
  'I go\t2',
  '',
].join('\n');
const th = Thesaurus.parse(DATA);

describe('thesaurus', () => {
  test('finds synonyms and related words for a dictionary form', () => {
    const r = th.lookup('quick')!;
    expect(r.senses[0]).toMatchObject({ pos: 'adjective', synonyms: ['speedy'], similar: ['fast'] });
    expect(topSynonyms(r)).toEqual(['speedy', 'fast']);
  });

  test('inflects synonyms like the selected word', () => {
    const r = th.lookup('walked')!;
    expect(r.lemmas).toEqual(['walk']);
    expect(r.senses[0].narrower).toEqual(['strolled']);
    expect(r.senses[0].broader).toEqual(['traveled', 'went']);
    expect(th.lookup('cars')!.senses[0].synonyms).toEqual(['automobiles', 'autos']);
    expect(th.lookup('walking', { context: 'She was walking home.' })!.senses[0].narrower).toEqual(['strolling']);
  });

  test('uses British doubling when asked', () => {
    expect(th.lookup('walked', { spelling: 'uk' })!.senses[0].broader[0]).toBe('travelled');
  });

  test('lists the part of speech used in the sentence first', () => {
    expect(th.lookup('walk', { context: 'We went for a walk.' })!.senses[0].pos).toBe('noun');
    expect(th.lookup('walk', { context: 'They walk to school.' })!.senses[0].pos).toBe('verb');
  });

  test('keeps capitalization and trims selections', () => {
    expect(th.lookup('Quick')!.senses[0].synonyms).toEqual(['Speedy']);
    expect(th.lookup('QUICK')!.senses[0].synonyms).toEqual(['SPEEDY']);
    expect(thesaurusQuery(' “quick,” ')).toBe('quick');
    expect(thesaurusQuery('a whole sentence that is far too long to be a term')).toBeNull();
    expect(thesaurusQuery('x = 1')).toBeNull();
    expect(th.lookup('unknownword')).toBeNull();
  });

  test('inflection helpers', () => {
    expect(inflect('go', 'verb', 'PastTense')).toBe('went');
    expect(inflect('go on foot', 'verb', 'Gerund')).toBe('going on foot');
    expect(inflect('mouse', 'noun', 'Plural')).toBe('mice');
    expect(inflect('happy', 'adjective', 'Comparative')).toBe('happier');
    expect(inflect('cheerful', 'adjective', 'Comparative')).toBe('more cheerful');
    expect(inflect('cancel', 'verb', 'PastTense')).toBe('canceled');
    expect(inflect('compel', 'verb', 'PastTense')).toBe('compelled');
    expect(matchCase('Hello', 'world')).toBe('World');
  });
});
