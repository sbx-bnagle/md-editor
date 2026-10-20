// Headline analysis: transparent heuristics for clarity and engagement. Every point
// added or removed is listed as a note so the writer can see why. These are rules of
// thumb, not predictions of performance; AI suggestions complement them.

import { syllables } from './readability';

export interface HeadlineNote {
  kind: 'good' | 'warn';
  text: string;
}

export interface HeadlineReport {
  text: string;
  words: number;
  characters: number;
  /** 0–100: how easily a reader understands it. */
  clarity: number;
  /** 0–100: how likely it is to draw a reader in. */
  engagement: number;
  notes: HeadlineNote[];
}

const VAGUE = new Set(
  'things thing stuff various aspects aspect solutions solution leverage leveraging synergy synergies innovative cutting-edge best-in-class world-class robust seamless holistic paradigm ecosystem empower empowering utilize utilizing facilitate optimize optimal next-generation state-of-the-art game-changing revolutionary transformative unlock'.split(' '),
);
const OUTCOME_VERBS = new Set(
  'save saves cut cuts reduce reduces improve improves grow grows learn build builds fix fixes avoid prevent prevents start stop find finds get gets make makes plan plans choose write ship launch protect raise lower speed double halve win'.split(' '),
);
const QUESTION_WORDS = /^(how|why|what|when|where|which|who|should|can|is|are|do|does)\b/i;
const PASSIVE = /\b(is|are|was|were|be|been|being|gets|got)\s+(\w+ed|\w+en)\b/i;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function analyzeHeadline(raw: string): HeadlineReport {
  const text = raw.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
  const words = text.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w));
  const lower = words.map((w) => w.toLowerCase().replace(/[^\p{L}\d'’-]/gu, ''));
  const notes: HeadlineNote[] = [];
  let clarity = 70;
  let engagement = 45;

  // Length
  if (words.length === 0) return { text, words: 0, characters: 0, clarity: 0, engagement: 0, notes: [{ kind: 'warn', text: 'Empty headline.' }] };
  if (words.length < 4) {
    engagement -= 10;
    notes.push({ kind: 'warn', text: `${words.length} word${words.length === 1 ? '' : 's'}: short headlines often leave out what the reader gets.` });
  } else if (words.length <= 12) {
    engagement += 10;
    notes.push({ kind: 'good', text: `${words.length} words: easy to take in at a glance.` });
  } else {
    clarity -= Math.min(20, (words.length - 12) * 3);
    notes.push({ kind: 'warn', text: `${words.length} words: consider cutting to 12 or fewer.` });
  }
  if (text.length > 70) {
    clarity -= 5;
    notes.push({ kind: 'warn', text: `${text.length} characters: search results and feeds may cut it off after about 60–70.` });
  }

  // Clarity
  const vague = lower.filter((w) => VAGUE.has(w));
  if (vague.length) {
    clarity -= vague.length * 10;
    notes.push({ kind: 'warn', text: `Vague or overused: ${[...new Set(vague)].map((w) => `“${w}”`).join(', ')}. Name the specific thing.` });
  }
  const acronyms = words.filter((w) => /^[A-Z]{3,}s?$/.test(w.replace(/[^\p{L}]/gu, '')));
  if (acronyms.length) {
    clarity -= 5 * acronyms.length;
    notes.push({ kind: 'warn', text: `Acronyms (${acronyms.join(', ')}) slow readers who do not know them.` });
  }
  if (PASSIVE.test(text)) {
    clarity -= 10;
    notes.push({ kind: 'warn', text: 'Passive voice: say who does what.' });
  }
  const longWords = words.filter((w) => syllables(w) >= 4).length;
  if (longWords >= 2) {
    clarity -= 5 * longWords;
    notes.push({ kind: 'warn', text: `${longWords} long words (four or more syllables).` });
  } else if (longWords === 0 && words.length >= 4) {
    clarity += 10;
    notes.push({ kind: 'good', text: 'Plain, short words.' });
  }
  if ((text.match(/,/g) ?? []).length >= 2) {
    clarity -= 5;
    notes.push({ kind: 'warn', text: 'Several commas: the headline may carry more than one idea.' });
  }

  // Engagement
  if (/\d/.test(text)) {
    engagement += 15;
    notes.push({ kind: 'good', text: 'Contains a number: specific and scannable.' });
  }
  if (QUESTION_WORDS.test(text) || text.endsWith('?')) {
    engagement += 10;
    notes.push({ kind: 'good', text: 'Opens a question the reader wants answered.' });
  }
  if (lower.some((w) => w === 'you' || w === 'your' || w === 'you’re' || w === "you're")) {
    engagement += 10;
    notes.push({ kind: 'good', text: 'Speaks to the reader directly.' });
  }
  if (lower.some((w) => OUTCOME_VERBS.has(w))) {
    engagement += 10;
    notes.push({ kind: 'good', text: 'Names an action or outcome.' });
  }
  const properNouns = words.slice(1).filter((w) => /^[A-Z][a-z]/.test(w)).length;
  if (properNouns > 0 && properNouns < words.length - 1) {
    engagement += 5;
    notes.push({ kind: 'good', text: 'Names a specific person, place, or product.' });
  }
  if (/!/.test(text)) {
    engagement -= 5;
    notes.push({ kind: 'warn', text: 'Exclamation marks tend to read as hype.' });
  }
  if (words.length >= 3 && words.every((w) => /^[A-Z]/.test(w))) {
    notes.push({ kind: 'warn', text: 'Every word is capitalized; check the style guide’s heading case.' });
  }

  return { text, words: words.length, characters: text.length, clarity: clamp(clarity), engagement: clamp(engagement), notes };
}
