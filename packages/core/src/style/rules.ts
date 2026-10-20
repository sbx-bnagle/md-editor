// Mechanical style rules. Each rule has a few settings; a style guide picks a base
// (unofficial, partial encodings of conventions associated with AP, Chicago and Oxford
// style) and overrides individual settings. Rules run on prose only (see prose.ts) and
// report positions in the original text.

import { maskNonProse, headingRanges } from '../prose';
import { curlyQuote } from '../smartQuotes';
import { spellingChecks, SPELLING_PAIRS, type SpellingTarget } from './spelling';

export interface StyleIssue {
  from: number;
  to: number;
  ruleId: string;
  message: string;
  suggestions: string[];
}

export interface StyleSettings {
  'serial-comma'?: 'required' | 'omit' | 'off';
  numbers?: 'spell-1-9' | 'spell-0-100' | 'numerals' | 'off';
  'em-dash'?: 'closed' | 'spaced' | 'avoid' | 'off';
  'range-dash'?: 'en-closed' | 'off';
  quotes?: 'curly' | 'off';
  'quote-style'?: 'double' | 'single' | 'off';
  'comma-in-quotes'?: 'inside' | 'off';
  spelling?: SpellingTarget | 'off';
  percent?: 'word' | 'symbol' | 'off';
  units?: 'closed' | 'spaced' | 'off';
  times?: 'periods' | 'closed' | 'off';
  ampersand?: 'avoid' | 'off';
  'heading-case'?: 'sentence' | 'off';
  'double-space'?: 'flag' | 'off';
  'repeated-words'?: 'flag' | 'off';
  wordy?: 'flag' | 'off';
}

export type RuleId = keyof StyleSettings;

export interface RuleInfo {
  id: RuleId;
  label: string;
  options: Record<string, string>;
}

/** Descriptions shown in the app and in docs. */
export const RULES: RuleInfo[] = [
  { id: 'serial-comma', label: 'Serial (Oxford) comma', options: { required: 'Comma before and/or in a list of three or more', omit: 'No comma before and/or in a simple list', off: 'Not checked' } },
  { id: 'numbers', label: 'Numbers', options: { 'spell-1-9': 'Spell out one to nine; numerals from 10', 'spell-0-100': 'Spell out zero to one hundred', numerals: 'Numerals for counts (3 departments)', off: 'Not checked' } },
  { id: 'em-dash', label: 'Em dash', options: { closed: 'No spaces around em dashes', spaced: 'A space on each side', avoid: 'Do not use em dashes', off: 'Not checked' } },
  { id: 'range-dash', label: 'Ranges', options: { 'en-closed': 'En dash with no spaces: 8–24', off: 'Not checked' } },
  { id: 'quotes', label: 'Curly quotes', options: { curly: 'Flag straight quotes in prose', off: 'Not checked' } },
  { id: 'quote-style', label: 'Quotation marks', options: { double: 'Double first, single inside', single: 'Single first, double inside', off: 'Not checked' } },
  { id: 'comma-in-quotes', label: 'Commas and periods with quotes', options: { inside: 'Inside the closing quote', off: 'Not checked' } },
  { id: 'spelling', label: 'Spelling', options: { us: 'US', uk: 'British (-ise)', oxford: 'British with -ize (Oxford spelling)', off: 'Not checked' } },
  { id: 'percent', label: 'Percent', options: { word: '“percent”', symbol: '% sign', off: 'Not checked' } },
  { id: 'units', label: 'Units', options: { closed: 'No space: 7mm, 60%', spaced: 'Space: 7 mm', off: 'Not checked' } },
  { id: 'times', label: 'Times of day', options: { periods: '9 a.m.', closed: '9am', off: 'Not checked' } },
  { id: 'ampersand', label: 'Ampersand', options: { avoid: 'Write “and” (except in names)', off: 'Not checked' } },
  { id: 'heading-case', label: 'Headings', options: { sentence: 'Sentence case', off: 'Not checked' } },
  { id: 'double-space', label: 'Spaces after periods', options: { flag: 'One space', off: 'Not checked' } },
  { id: 'repeated-words', label: 'Repeated words', options: { flag: 'Flag “the the”', off: 'Not checked' } },
  { id: 'wordy', label: 'Wordy phrases', options: { flag: 'Suggest shorter wording', off: 'Not checked' } },
];

const ALL_OFF: Required<StyleSettings> = {
  'serial-comma': 'off',
  numbers: 'off',
  'em-dash': 'off',
  'range-dash': 'off',
  quotes: 'off',
  'quote-style': 'off',
  'comma-in-quotes': 'off',
  spelling: 'off',
  percent: 'off',
  units: 'off',
  times: 'off',
  ampersand: 'off',
  'heading-case': 'off',
  'double-space': 'off',
  'repeated-words': 'off',
  wordy: 'off',
};

export type BaseId = 'ap' | 'chicago' | 'oxford' | 'none';

/**
 * Unofficial, partial bases. They encode only widely known, mechanically checkable
 * conventions and do not reproduce the published guides. Settings we could not state
 * with confidence for a guide are left off.
 */
export const BASES: Record<BaseId, { label: string; description: string; settings: Required<StyleSettings> }> = {
  ap: {
    label: 'AP-like',
    description: 'Unofficial subset of conventions associated with AP style: no serial comma, numerals from 10, spaced em dashes, a.m./p.m.',
    settings: { ...ALL_OFF, 'serial-comma': 'omit', numbers: 'spell-1-9', 'em-dash': 'spaced', quotes: 'curly', 'quote-style': 'double', 'comma-in-quotes': 'inside', spelling: 'us', times: 'periods', ampersand: 'avoid', 'double-space': 'flag', 'repeated-words': 'flag' },
  },
  chicago: {
    label: 'Chicago-like',
    description: 'Unofficial subset of conventions associated with Chicago style: serial comma, numbers spelled out to one hundred, closed em dashes, en dash ranges.',
    settings: { ...ALL_OFF, 'serial-comma': 'required', numbers: 'spell-0-100', 'em-dash': 'closed', 'range-dash': 'en-closed', quotes: 'curly', 'quote-style': 'double', 'comma-in-quotes': 'inside', spelling: 'us', percent: 'word', times: 'periods', 'double-space': 'flag', 'repeated-words': 'flag' },
  },
  oxford: {
    label: 'Oxford-like',
    description: 'Unofficial subset of conventions associated with Oxford (New Hart’s Rules) style: serial comma, Oxford spelling (-ize), single quotation marks, en dash ranges.',
    settings: { ...ALL_OFF, 'serial-comma': 'required', numbers: 'spell-0-100', 'range-dash': 'en-closed', quotes: 'curly', 'quote-style': 'single', spelling: 'oxford', 'double-space': 'flag', 'repeated-words': 'flag' },
  },
  none: { label: 'No base', description: 'Only the rules the guide turns on.', settings: { ...ALL_OFF } },
};

export interface CustomRules {
  /** Word choices: use `use` instead of any of `not`. */
  replace?: Array<{ use: string; not: string | string[]; message?: string }>;
  /** Words or phrases to avoid, with an optional suggestion. */
  avoid?: Array<{ phrase: string; message?: string; suggest?: string }>;
  /** Regular expressions (case-insensitive unless `flags` says otherwise). */
  patterns?: Array<{ match: string; message: string; suggest?: string; flags?: string }>;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberToWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n === 100) return 'one hundred';
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

const WORD_NUMBERS = new Map<string, number>([...ONES.map((w, i) => [w, i] as [string, number]), ...TENS.slice(2).map((w, i) => [w, (i + 2) * 10] as [string, number])]);

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
const UNIT_WORDS = 'mm|cm|km|ft|yd|mi|kg|lb|lbs|oz|ml|mph|kph|px|pt|°F|°C|°|GB|MB|KB|TB|hrs?|mins?';

const WORDY: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\ba large number of\b/gi, 'many'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bhave the ability to\b/gi, 'can'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bprior to\b/gi, 'before'],
  [/\bin close proximity to\b/gi, 'near'],
  [/\beach and every\b/gi, 'each'],
  [/\bin a timely manner\b/gi, 'promptly'],
  [/\bat the present time\b/gi, 'now'],
];

const HEADING_SMALL_WORDS = new Set(
  'a an the and but or nor for so yet as at by in of on to up via with from into onto over than that this these those your our their its his her my we you they it is are was were be been how what why when where who which new about after all any before between both each more most not only other out same some such then there through under until very will can do does should would could may might must'.split(' '),
);

const NOT_REPEATED = new Set(['that', 'had', 'is', 'do', 'bye', 'very', 'so', 'no', 'ha', 'la']);

function serialCommaRequired(masked: string, add: (from: number, to: number, message: string, s: string[]) => void) {
  // "A, B and C." A list is only assumed when the items are single words and the last one
  // ends the clause, or when more items precede it ("A, B, C and D"), to avoid flagging
  // "In the morning, John and Mary left".
  const W = String.raw`[\p{L}][\p{L}’'-]*`;
  const re = new RegExp(String.raw`(${W}), (${W}) (and|or) (${W})(?=[.,;:!?)\n]|$)|(, ${W}), (${W}) (and|or) `, 'gu');
  const lead = new Set(['however', 'yes', 'no', 'well', 'so', 'then', 'now', 'first', 'second', 'finally', 'also', 'still', 'instead', 'meanwhile', 'otherwise', 'today', 'here', 'there', 'thus', 'hence', 'therefore', 'indeed', 'oh', 'please', 'sure']);
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const first = (m[1] ?? m[5]).replace(/^, /, '');
    const conj = m[3] ?? m[7];
    if (lead.has(first.toLowerCase())) continue;
    const at = m[3] ? m.index + m[1].length + 2 + m[2].length : m.index + m[5].length + 2 + m[6].length;
    add(at, at + 1, `Possible list without a serial comma before “${conj}”.`, [`, `]);
    re.lastIndex = at + 1;
  }
}

function serialCommaOmit(masked: string, add: (from: number, to: number, message: string, s: string[]) => void) {
  const re = /([\p{L}][\p{L}’'-]*), ([\p{L}][\p{L}’'-]*(?: [\p{L}][\p{L}’'-]*){0,2}), (and|or) /gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const comma = m.index + m[0].length - m[3].length - 3;
    add(comma, comma + 1, `This style omits the serial comma before “${m[3]}” in a simple list.`, ['']);
    re.lastIndex = comma + 1;
  }
}

export function checkStyle(text: string, settings: StyleSettings, custom: CustomRules = {}): StyleIssue[] {
  const s = { ...ALL_OFF, ...settings };
  const masked = maskNonProse(text);
  const issues: StyleIssue[] = [];
  const add = (ruleId: string) => (from: number, to: number, message: string, suggestions: string[] = []) =>
    issues.push({ from, to, ruleId, message, suggestions });
  const each = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      fn(m);
      if (m[0].length === 0) re.lastIndex++;
    }
  };

  if (s['serial-comma'] === 'required') serialCommaRequired(masked, add('serial-comma'));
  if (s['serial-comma'] === 'omit') serialCommaOmit(masked, add('serial-comma'));

  if (s.numbers === 'spell-1-9' || s.numbers === 'spell-0-100') {
    const max = s.numbers === 'spell-1-9' ? 9 : 100;
    const min = s.numbers === 'spell-1-9' ? 1 : 0;
    const re = new RegExp(String.raw`(?<![\w.,:/$#£€+-])(\d{1,3})(?![\w.,:/%°]|\s?(?:%|percent|per cent|a\.m\.|p\.m\.|am\b|pm\b|${UNIT_WORDS})\b)`, 'g');
    each(re, (m) => {
      const n = Number(m[1]);
      if (n < min || n > max || m[1].startsWith('0') && m[1] !== '0') return;
      const before = masked.slice(Math.max(0, m.index - 12), m.index);
      if (new RegExp(`(?:${MONTHS})\\.? $`).test(before)) return; // dates
      if (/^\s*$/.test(masked.slice(masked.lastIndexOf('\n', m.index) + 1, m.index)) && /^[.)]/.test(masked[m.index + m[1].length] ?? '')) return; // list numbers
      add('numbers')(m.index, m.index + m[1].length, `Spell out ${n} in running text.`, [numberToWords(n)]);
    });
  }
  if (s.numbers === 'numerals') {
    // Number words used as counts: "three departments" -> "3 departments".
    each(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+([\p{L}]+s)\b/giu, (m) => {
      const n = WORD_NUMBERS.get(m[1].toLowerCase());
      if (n === undefined) return;
      add('numbers')(m.index, m.index + m[1].length, 'Use numerals for counts.', [String(n)]);
    });
  }

  if (s['em-dash'] === 'closed') each(/ +— +|(?<=\S) +—|— +(?=\S)/g, (m) => add('em-dash')(m.index, m.index + m[0].length, 'No spaces around em dashes.', ['—']));
  if (s['em-dash'] === 'spaced') each(/(?<=\S)—(?=\S)/g, (m) => add('em-dash')(m.index, m.index + 1, 'Put a space on each side of an em dash.', [' — ']));
  if (s['em-dash'] === 'avoid') each(/ ?— ?/g, (m) => add('em-dash')(m.index, m.index + m[0].length, 'Avoid em dashes: use a comma, parentheses, or separate sentences.', [', ', '. ']));

  if (s['range-dash'] === 'en-closed') {
    each(/(?<![\d-])(\$?\d[\d,.]*)\s*[-–]\s*(\$?\d[\d,.]*)(?![\d-])/g, (m) => {
      if (m[0] === `${m[1]}–${m[2]}`) return;
      add('range-dash')(m.index, m.index + m[0].length, 'Use an en dash with no spaces for ranges.', [`${m[1]}–${m[2]}`]);
    });
  }

  if (s.quotes === 'curly') {
    each(/["']/g, (m) => {
      const prev = m.index > 0 ? masked[m.index - 1] : undefined;
      add('quotes')(m.index, m.index + 1, 'Use curly quotes.', [curlyQuote(m[0] as '"' | "'", prev)]);
    });
  }
  if (s['quote-style'] === 'single') each(/“([^”\n]*)”/g, (m) => {
    const before = masked.slice(Math.max(0, masked.lastIndexOf('\n', m.index)), m.index);
    if ((before.match(/‘/g) ?? []).length > (before.match(/’(?!\p{L})/gu) ?? []).length) return; // nested
    add('quote-style')(m.index, m.index + m[0].length, 'This style uses single quotation marks first.', [`‘${m[1]}’`]);
  });
  if (s['quote-style'] === 'double') each(/(?<![\p{L}\d])‘([^’\n]+)’(?![\p{L}])/gu, (m) => {
    const before = masked.slice(Math.max(0, masked.lastIndexOf('\n', m.index)), m.index);
    if ((before.match(/“/g) ?? []).length > (before.match(/”/g) ?? []).length) return; // nested
    add('quote-style')(m.index, m.index + m[0].length, 'This style uses double quotation marks first.', [`“${m[1]}”`]);
  });
  if (s['comma-in-quotes'] === 'inside') each(/([”’])([,.])/g, (m) => {
    if (m[1] === '’') {
      const lineStart = masked.lastIndexOf('\n', m.index) + 1;
      if (!masked.slice(lineStart, m.index).includes('‘')) return; // apostrophe, not a quote
    }
    add('comma-in-quotes')(m.index, m.index + 2, `Put the ${m[2] === ',' ? 'comma' : 'period'} inside the closing quote.`, [`${m[2]}${m[1]}`]);
  });

  if (s.spelling !== 'off') {
    for (const { wrong, right } of spellingChecks(s.spelling)) {
      const pair = SPELLING_PAIRS.find((p) => p.us === wrong || p.uk === wrong)!;
      const re = new RegExp(String.raw`(?<![\p{L}])(${wrong})(\p{L}*)`, 'giu');
      each(re, (m) => {
        const suffix = m[2].toLowerCase();
        const ok =
          pair.group === 'ize'
            ? /^(e|ed|es|er|ers|ing|ation|ations|able)$/.test(suffix)
            : pair.group === 'yze'
              ? /^(e|ed|es|er|ers|ing)$/.test(suffix)
              : pair.group === 'll'
                ? /^s?$/.test(suffix)
                : pair.group === 're'
                  ? /^(s|d|ed)?$/.test(suffix)
                  : !(wrong === 'grey' && suffix.startsWith('hound'));
        if (!ok) return;
        let tail = m[2];
        if (pair.group === 're') tail = right.endsWith('re') ? tail.replace(/^ed$/i, 'd') : tail.replace(/^d$/i, 'ed');
        const word = matchCase(m[1], right) + tail;
        add('spelling')(m.index, m.index + m[0].length, `${s.spelling === 'us' ? 'US' : s.spelling === 'oxford' ? 'Oxford' : 'British'} spelling: “${word}”.`, [word]);
      });
    }
  }

  if (s.percent === 'word') each(/(\d)\s?%/g, (m) => add('percent')(m.index + 1, m.index + m[0].length, 'Write “percent”.', [' percent']));
  if (s.percent === 'symbol') each(/(\d)\s+(percent|per cent)\b/gi, (m) => add('percent')(m.index + 1, m.index + m[0].length, 'Use the % sign.', ['%']));

  if (s.units === 'closed') each(new RegExp(String.raw`(\d)( +)(${UNIT_WORDS}|%)(?![\p{L}])`, 'gu'), (m) => add('units')(m.index + 1, m.index + 1 + m[2].length, 'No space between a number and its unit.', ['']));
  if (s.units === 'spaced') each(/(\d)(mm|cm|km|ft|kg|lb|oz|ml|mph)\b/g, (m) => add('units')(m.index + 1, m.index + 1, 'Put a space between a number and its unit.', [' ']));

  if (s.times === 'periods') each(/(\d)\s?(am|pm|AM|PM|A\.M\.|P\.M\.)(?![\p{L}])/gu, (m) => {
    const fixed = `${m[1]} ${m[2].toLowerCase().replace(/^([ap])\.?m\.?$/, '$1.m.')}`;
    if (m[0] === fixed) return;
    add('times')(m.index, m.index + m[0].length, 'Write times as “9 a.m.”', [fixed]);
  });
  if (s.times === 'closed') each(/(\d)\s?(am|pm|AM|PM|a\.m\.|p\.m\.|A\.M\.|P\.M\.)(?![\p{L}])/gu, (m) => {
    const fixed = `${m[1]}${m[2].toLowerCase().replace(/\./g, '')}`;
    if (m[0] === fixed) return;
    add('times')(m.index, m.index + m[0].length, 'Write times as “9am”: lowercase, no space.', [fixed]);
  });

  if (s.ampersand === 'avoid') each(/(?<=\s)&(?=\s)/g, (m) => {
    const before = masked.slice(Math.max(0, m.index - 30), m.index);
    const after = masked.slice(m.index + 1, m.index + 30);
    if (/[A-Z][\p{L}]*\s$/u.test(before) && /^\s[A-Z]/.test(after)) return; // likely a name: Johnson & Johnson
    add('ampersand')(m.index, m.index + 1, 'Write “and” instead of “&”.', ['and']);
  });

  if (s['heading-case'] === 'sentence') {
    for (const h of headingRanges(text)) {
      const words = h.text.split(/(\s+)/);
      let changed = false;
      let afterColon = false;
      const fixed = words.map((w, i) => {
        if (i === 0 || /^\s+$/.test(w)) return w;
        const prevColon = afterColon;
        afterColon = /:$/.test(w);
        if (prevColon) return w;
        const bare = w.replace(/[^\p{L}’'-]/gu, '');
        if (bare && bare !== 'I' && bare[0] === bare[0].toUpperCase() && bare.slice(1) === bare.slice(1).toLowerCase() && HEADING_SMALL_WORDS.has(bare.toLowerCase())) {
          changed = true;
          return w.replace(bare, bare.toLowerCase());
        }
        return w;
      });
      const capitalised = words.filter((w, i) => i > 0 && /^[A-Z][a-z]/.test(w)).length;
      if (changed && capitalised >= 2) add('heading-case')(h.from, h.to, 'Use sentence case for headings.', [fixed.join('')]);
    }
  }

  if (s['double-space'] === 'flag') each(/(?<=[.!?:;”’)])  +(?=\S)/g, (m) => add('double-space')(m.index, m.index + m[0].length, 'Use one space after a period.', [' ']));

  if (s['repeated-words'] === 'flag') each(/(?<![\p{L}])([\p{L}]+)(\s+)\1(?![\p{L}])/giu, (m) => {
    if (NOT_REPEATED.has(m[1].toLowerCase())) return;
    if (m[2].includes('\n\n')) return;
    add('repeated-words')(m.index, m.index + m[0].length, `“${m[1]}” is repeated.`, [m[1]]);
  });

  if (s.wordy === 'flag') for (const [re, short] of WORDY) each(re, (m) => add('wordy')(m.index, m.index + m[0].length, `Shorter: “${short}”.`, [matchCase(m[0], short)]));

  for (const r of custom.replace ?? []) {
    for (const not of Array.isArray(r.not) ? r.not : [r.not]) {
      const re = new RegExp(String.raw`(?<![\p{L}])(${escapeRe(not)})(?![\p{L}])`, 'giu');
      each(re, (m) => add('custom')(m.index, m.index + m[0].length, r.message ?? `Use “${r.use}”.`, [matchCase(m[0], r.use)]));
    }
  }
  for (const a of custom.avoid ?? []) {
    const re = new RegExp(String.raw`(?<![\p{L}])${escapeRe(a.phrase)}(?![\p{L}])`, 'giu');
    each(re, (m) => add('custom')(m.index, m.index + m[0].length, a.message ?? `Avoid “${a.phrase}”.`, a.suggest ? [matchCase(m[0], a.suggest)] : []));
  }
  for (const p of custom.patterns ?? []) {
    let re: RegExp;
    try {
      re = new RegExp(p.match, (p.flags ?? 'i').replace('g', '') + 'gu');
    } catch {
      continue;
    }
    each(re, (m) => add('custom')(m.index, m.index + m[0].length, p.message, p.suggest !== undefined ? [m[0].replace(new RegExp(p.match, (p.flags ?? 'i').replace('g', '') + 'u'), p.suggest)] : []));
  }

  return issues.sort((a, b) => a.from - b.from || a.to - b.to);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
