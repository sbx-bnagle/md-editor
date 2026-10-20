// Readability grading with standard public formulas (Flesch Reading Ease,
// Flesch–Kincaid Grade, Gunning Fog, SMOG, Coleman–Liau, ARI). Syllables are
// estimated with a heuristic, so scores are approximate.

import { plainProse } from './prose';

export interface SentenceGrade {
  from: number;
  to: number;
  words: number;
  grade: number;
}

export interface ReadabilityReport {
  words: number;
  sentences: number;
  syllables: number;
  complexWords: number;
  letters: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  gunningFog: number;
  smog: number;
  colemanLiau: number;
  ari: number;
  /** Mean of the five grade-level scores. */
  averageGrade: number;
  readingMinutes: number;
  sentenceGrades: SentenceGrade[];
}

/** Estimated syllables in an English word. */
export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  let n = groups ? groups.length : 1;
  if (/[^aeiouy]le$/.test(word.toLowerCase())) n++;
  return Math.max(1, n);
}

const round = (n: number) => Math.round(n * 10) / 10;

function words(text: string): Array<{ word: string; index: number }> {
  const seg = new Intl.Segmenter('en', { granularity: 'word' });
  const out: Array<{ word: string; index: number }> = [];
  for (const s of seg.segment(text)) if (s.isWordLike && /\p{L}/u.test(s.segment)) out.push({ word: s.segment, index: s.index });
  return out;
}

function fkGrade(w: number, s: number, syl: number): number {
  return 0.39 * (w / s) + 11.8 * (syl / w) - 15.59;
}

export function readability(markdown: string): ReadabilityReport {
  const plain = plainProse(markdown);
  const original = markdown.split('\n');
  // Paragraphs: split on blank lines and at list items, so unpunctuated items are not
  // merged into one long sentence. Headings and table rows are not counted.
  const parts: Array<{ start: number; text: string }> = [];
  let offset = 0;
  let current: { start: number; text: string } | null = null;
  plain.split('\n').forEach((line, i) => {
    const src = original[i] ?? '';
    const skip = /^\s{0,3}#{1,6}\s/.test(src) || /^\s*\|/.test(src);
    const startsItem = /^\s*(?:[-*+]|\d+[.)])\s/.test(src);
    if (!line.trim() || skip || startsItem || !current) {
      if (current) parts.push(current);
      current = !line.trim() || skip ? null : { start: offset, text: line };
    } else {
      current.text += `\n${line}`;
    }
    offset += line.length + 1;
  });
  if (current) parts.push(current);

  const sentenceSeg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const sentenceGrades: SentenceGrade[] = [];
  let W = 0;
  let S = 0;
  let SYL = 0;
  let complex = 0;
  let poly = 0;
  let letters = 0;
  for (const part of parts) {
    for (const s of sentenceSeg.segment(part.text)) {
      const ws = words(s.segment);
      if (ws.length === 0) continue;
      let syl = 0;
      for (const { word } of ws) {
        const n = syllables(word);
        syl += n;
        if (n >= 3) {
          poly++;
          if (!/(?:es|ed|ing)$/i.test(word)) complex++;
        }
        letters += word.replace(/[^\p{L}]/gu, '').length;
      }
      W += ws.length;
      S += 1;
      SYL += syl;
      const from = part.start + s.index + ws[0].index;
      const lastWord = ws[ws.length - 1];
      const to = part.start + s.index + lastWord.index + lastWord.word.length;
      sentenceGrades.push({ from, to, words: ws.length, grade: round(fkGrade(ws.length, 1, syl)) });
    }
  }
  if (W === 0 || S === 0) {
    return { words: 0, sentences: 0, syllables: 0, complexWords: 0, letters: 0, fleschReadingEase: 0, fleschKincaidGrade: 0, gunningFog: 0, smog: 0, colemanLiau: 0, ari: 0, averageGrade: 0, readingMinutes: 0, sentenceGrades: [] };
  }
  const fre = 206.835 - 1.015 * (W / S) - 84.6 * (SYL / W);
  const fk = fkGrade(W, S, SYL);
  const fog = 0.4 * (W / S + 100 * (complex / W));
  const smog = 1.043 * Math.sqrt(poly * (30 / S)) + 3.1291;
  const L = (letters / W) * 100;
  const S100 = (S / W) * 100;
  const cli = 0.0588 * L - 0.296 * S100 - 15.8;
  const ari = 4.71 * (letters / W) + 0.5 * (W / S) - 21.43;
  return {
    words: W,
    sentences: S,
    syllables: SYL,
    complexWords: complex,
    letters,
    fleschReadingEase: round(fre),
    fleschKincaidGrade: round(fk),
    gunningFog: round(fog),
    smog: round(smog),
    colemanLiau: round(cli),
    ari: round(ari),
    averageGrade: round((fk + fog + smog + cli + ari) / 5),
    readingMinutes: Math.max(1, Math.round(W / 230)),
    sentenceGrades,
  };
}

/** Plain-language label for a Flesch Reading Ease score. */
export function easeLabel(score: number): string {
  if (score >= 90) return 'Very easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly easy';
  if (score >= 60) return 'Plain English';
  if (score >= 50) return 'Fairly difficult';
  if (score >= 30) return 'Difficult';
  return 'Very difficult';
}
