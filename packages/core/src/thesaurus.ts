// Offline thesaurus built from WordNet 3.1 (scripts/build-thesaurus.mjs). Lookups find the
// dictionary form of an inflected word and return synonyms in the same form where the
// inflection can be produced (compromise conjugates verbs and pluralizes nouns).

import { strFromU8, unzlibSync } from 'fflate';
import nlp from 'compromise';
import { syllables } from './readability';

export type WordForm = 'base' | 'Plural' | 'PastTense' | 'Participle' | 'Gerund' | 'PresentTense' | 'Comparative' | 'Superlative';
export type SensePos = 'noun' | 'verb' | 'adjective' | 'adverb';

export interface ThesaurusSense {
  pos: SensePos;
  gloss: string;
  /** Words with the same meaning. */
  synonyms: string[];
  /** Similar words (adjectives, adverbs) and "see also" entries. */
  similar: string[];
  /** More general terms. */
  broader: string[];
  /** More specific terms. */
  narrower: string[];
}

export interface ThesaurusResult {
  /** The text that was looked up. */
  word: string;
  /** Dictionary forms that matched, e.g. ["run"] for "running". */
  lemmas: string[];
  senses: ThesaurusSense[];
}

export interface ThesaurusOptions {
  /** The sentence around the word; its grammar decides which part of speech is listed first. */
  context?: string;
  /** Spelling of inflected forms: US "traveled" or British "travelled". */
  spelling?: 'us' | 'uk';
}

const POS: Record<string, SensePos> = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
const MAX_SENSES = 10;
const LIMITS = { synonyms: 12, similar: 10, broader: 4, narrower: 8 };

interface Candidate {
  lemma: string;
  form: WordForm;
  /** Restrict to senses of this part of speech (inflected forms). */
  pos?: SensePos;
}

type World = { methods: { two: { transform: Transforms } }; model: unknown };
interface Transforms {
  noun: { toPlural(w: string, m: unknown): string; toSingular(w: string, m: unknown): string };
  verb: { toInfinitive(w: string, m: unknown, tense?: string): string; conjugate(w: string, m: unknown): Record<string, string | undefined> };
  adjective: { toComparative(w: string, m: unknown): string; toSuperlative(w: string, m: unknown): string; fromComparative(w: string, m: unknown): string; fromSuperlative(w: string, m: unknown): string };
}

let world: World | null = null;
function transforms(): { t: Transforms; m: unknown } {
  world ??= (nlp as unknown as { world(): World }).world();
  return { t: world.methods.two.transform, m: world.model };
}

const VERB_FORMS = ['PastTense', 'Participle', 'Gerund', 'PresentTense'] as const;
/** Verbs whose past tense is the same as the base form. */
const UNCHANGED_PAST = new Set(['bet', 'bid', 'broadcast', 'burst', 'cast', 'cost', 'cut', 'fit', 'hit', 'hurt', 'let', 'put', 'quit', 'read', 'rid', 'set', 'shed', 'shut', 'slit', 'split', 'spread', 'thrust', 'upset', 'wet']);
/** Verbs stressed on a final -l syllable, which double the l in US spelling too. */
const STRESSED_FINAL_L = new Set(['annul', 'compel', 'control', 'dispel', 'enrol', 'enthral', 'excel', 'expel', 'extol', 'impel', 'instil', 'patrol', 'propel', 'rebel', 'repel']);

/** US spelling keeps a single l in travel → traveled, unless the last syllable is stressed. */
function usSpelling(base: string, inflected: string): string {
  if (!/[aeiou]l$/.test(base) || syllables(base) < 2 || STRESSED_FINAL_L.has(base)) return inflected;
  return inflected.replace(new RegExp(`^${base}l(ed|ing)$`), `${base}$1`);
}

/** Inflects a dictionary form; multi-word verbs inflect the first word, nouns the last. Returns null if unsure. */
export function inflect(word: string, pos: SensePos, form: WordForm, spelling: 'us' | 'uk' = 'us'): string | null {
  if (form === 'base') return word;
  const { t, m } = transforms();
  const parts = word.split(' ');
  try {
    if (pos === 'noun' && form === 'Plural') {
      const last = parts[parts.length - 1];
      const plural = t.noun.toPlural(last, m);
      if (!plural || plural === last) return null;
      return [...parts.slice(0, -1), plural].join(' ');
    }
    if (pos === 'verb' && (VERB_FORMS as readonly string[]).includes(form)) {
      const head = parts[0];
      if (/[^a-z]/.test(head)) return null;
      const conj = t.verb.conjugate(head, m);
      let v = conj[form] ?? (form === 'Participle' ? conj.PastTense : undefined);
      if (!v) return null;
      if (form === 'Gerund' && !v.endsWith('ing')) return null;
      if (form === 'PresentTense' && !v.endsWith('s')) return null;
      if ((form === 'PastTense' || form === 'Participle') && v === head && !UNCHANGED_PAST.has(head)) return null;
      if (spelling === 'us') v = usSpelling(head, v);
      return [v, ...parts.slice(1)].join(' ');
    }
    if (pos === 'adjective' && (form === 'Comparative' || form === 'Superlative')) {
      // Skip words that are already comparative ("larger") rather than write "most larger".
      const base = t.adjective.fromComparative(word, m);
      if (base && base !== word && t.adjective.toComparative(base, m) === word) return null;
      const more = `${form === 'Comparative' ? 'more' : 'most'} ${word}`;
      // -er and -est only for one syllable, or two ending in -y (happier); otherwise more/most.
      const n = syllables(word);
      if (parts.length > 1 || /[^a-z]/.test(word) || /ed$/.test(word) || n > 2 || (n === 2 && !word.endsWith('y'))) return more;
      const v = form === 'Comparative' ? t.adjective.toComparative(word, m) : t.adjective.toSuperlative(word, m);
      return v && v !== word ? v : more;
    }
  } catch {
    return null;
  }
  return null;
}

/** Applies the capitalization of `original` (Title or ALL CAPS) to `word`. */
export function matchCase(original: string, word: string): string {
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return word.toUpperCase();
  const first = original.match(/\p{L}/u)?.[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

/** Trims punctuation and spacing a selection may carry; returns null for text that is not a word or short phrase. */
export function thesaurusQuery(selection: string): string | null {
  const s = selection.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!s || s.length > 60 || s.split(' ').length > 4) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}'’ .-]*$/u.test(s)) return null;
  return s.replace(/’/g, "'");
}

/** The part of speech the word has in its sentence, if compromise can tell. */
function posInContext(word: string, context: string): SensePos | null {
  try {
    const m = nlp(context).match(word);
    if (!m.found) return null;
    if (m.has('#Verb')) return 'verb';
    if (m.has('#Adjective')) return 'adjective';
    if (m.has('#Adverb')) return 'adverb';
    if (m.has('#Noun')) return 'noun';
  } catch {
    // Fall back to the dictionary order.
  }
  return null;
}

export class Thesaurus {
  private readonly synsets: string[];
  private readonly index: Map<string, string>;

  private constructor(synsets: string[], index: Map<string, string>) {
    this.synsets = synsets;
    this.index = index;
  }

  /** Reads the zlib-compressed data file written by scripts/build-thesaurus.mjs. */
  static decode(bytes: Uint8Array): Thesaurus {
    return Thesaurus.parse(strFromU8(unzlibSync(bytes)));
  }

  static parse(text: string): Thesaurus {
    if (!text.startsWith('MDETHES1\n')) throw new Error('Not a thesaurus file');
    const synsets: string[] = [];
    const index = new Map<string, string>();
    let start = text.indexOf('\n') + 1;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      if (text.charCodeAt(start) === 83 /* S */) synsets.push(text.slice(start + 2, end));
      else if (text.charCodeAt(start) === 73 /* I */) {
        const tab = text.indexOf('\t', start);
        index.set(text.slice(start + 2, tab), text.slice(tab + 1, end));
      }
      start = end + 1;
    }
    return new Thesaurus(synsets, index);
  }

  has(lemma: string): boolean {
    return this.index.has(lemma);
  }

  private synset(id: number): { pos: SensePos; gloss: string; words: string[]; related: Array<[string, number]> } {
    const [head, words, related] = this.synsets[id].split('\t');
    return {
      pos: POS[head[0]],
      gloss: head.slice(2),
      words: words ? words.split('|') : [],
      related: related ? related.split(',').map((r) => [r[0], Number(r.slice(2))] as [string, number]) : [],
    };
  }

  /** Dictionary forms the text could be, with the inflection each implies. */
  candidates(text: string): Candidate[] {
    const lower = text.toLowerCase();
    const out: Candidate[] = [];
    if (this.index.has(lower)) out.push({ lemma: lower, form: 'base' });
    const { t, m } = transforms();
    const parts = lower.split(' ');
    const head = parts[0];
    const rest = parts.slice(1);
    const add = (lemma: string, form: WordForm, pos: SensePos) => {
      if (lemma && lemma !== lower && this.index.has(lemma) && !out.some((c) => c.lemma === lemma && c.pos === pos)) out.push({ lemma, form, pos });
    };
    try {
      for (const tense of VERB_FORMS) {
        const inf = t.verb.toInfinitive(head, m, tense);
        if (!inf || inf === head) continue;
        const conj = t.verb.conjugate(inf, m);
        const made = conj[tense] ?? (tense === 'Participle' ? conj.PastTense : undefined) ?? '';
        if (made === head || usSpelling(inf, made) === head) add([inf, ...rest].join(' '), tense, 'verb');
      }
      const last = parts[parts.length - 1];
      const singular = t.noun.toSingular(last, m);
      if (singular && singular !== last && t.noun.toPlural(singular, m) === last) add([...parts.slice(0, -1), singular].join(' '), 'Plural', 'noun');
      if (parts.length === 1) {
        const fromComp = t.adjective.fromComparative(lower, m);
        if (fromComp && fromComp !== lower && t.adjective.toComparative(fromComp, m) === lower) add(fromComp, 'Comparative', 'adjective');
        const fromSup = t.adjective.fromSuperlative(lower, m);
        if (fromSup && fromSup !== lower && t.adjective.toSuperlative(fromSup, m) === lower) add(fromSup, 'Superlative', 'adjective');
      }
    } catch {
      // compromise could not analyse the word; exact matches still work.
    }
    return out;
  }

  lookup(selection: string, options: ThesaurusOptions = {}): ThesaurusResult | null {
    const query = thesaurusQuery(selection);
    if (!query) return null;
    const cands = this.candidates(query);
    if (!cands.length) return null;
    const spelling = options.spelling ?? 'us';
    const senses: ThesaurusSense[] = [];
    const seen = new Set<number>();
    for (const c of cands) {
      for (const id of this.index.get(c.lemma)!.split(',').map(Number)) {
        if (seen.has(id)) continue;
        const s = this.synset(id);
        if (c.pos && s.pos !== c.pos) continue;
        seen.add(id);
        const exclude = new Set([c.lemma, query.toLowerCase()]);
        const used = new Set<string>();
        const words = (list: string[], limit: number) => {
          const result: string[] = [];
          for (const w of list) {
            if (result.length >= limit) break;
            if (exclude.has(w.toLowerCase())) continue;
            const inflected = inflect(w, s.pos, c.form, spelling);
            if (inflected === null) continue;
            const final = matchCase(query, inflected);
            if (used.has(final.toLowerCase())) continue;
            used.add(final.toLowerCase());
            result.push(final);
          }
          return result;
        };
        // The data file lists related synsets most common first.
        const related = (kind: string, take: number) => s.related.filter(([k]) => k === kind).flatMap(([, rid]) => this.synset(rid).words.slice(0, take));
        const sense: ThesaurusSense = {
          pos: s.pos,
          gloss: s.gloss,
          synonyms: words(s.words, LIMITS.synonyms),
          similar: words(related('s', 3), LIMITS.similar),
          broader: words(related('b', 2), LIMITS.broader),
          narrower: words(related('n', 1), LIMITS.narrower),
        };
        if (sense.synonyms.length + sense.similar.length + sense.broader.length + sense.narrower.length) senses.push(sense);
      }
    }
    if (!senses.length) return null;
    const preferred = options.context ? posInContext(query, options.context) : null;
    if (preferred) senses.sort((a, b) => Number(a.pos !== preferred) - Number(b.pos !== preferred));
    return { word: query, lemmas: [...new Set(cands.map((c) => c.lemma))], senses: senses.slice(0, MAX_SENSES) };
  }
}

/** Words that can stand in for the looked-up word in a sense: synonyms, then (verbs) more specific verbs or (adjectives, adverbs) similar words. */
export function replacements(sense: ThesaurusSense): string[] {
  if (sense.pos === 'verb') return [...sense.synonyms, ...sense.narrower, ...sense.similar];
  if (sense.pos === 'adjective' || sense.pos === 'adverb') return [...sense.synonyms, ...sense.similar];
  return sense.synonyms;
}

/** The words to list first: a few from each of the main senses, in sense order. */
export function topSynonyms(result: ThesaurusResult, max = 8, perSense = 4): string[] {
  const out: string[] = [];
  for (const s of result.senses.slice(0, 4)) {
    let taken = 0;
    for (const w of replacements(s)) {
      if (out.length >= max) return out;
      if (taken >= perSense) break;
      if (out.some((o) => o.toLowerCase() === w.toLowerCase())) continue;
      out.push(w);
      taken++;
    }
  }
  return out;
}
