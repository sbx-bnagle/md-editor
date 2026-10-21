// Builds the offline thesaurus (resources for the backend) from the WordNet 3.1 database
// in the wordnet-db package. Output: a deflated text file read by packages/core/src/thesaurus.ts.
//
//   node scripts/build-thesaurus.mjs <out-file>
//
// Format (UTF-8 before deflate):
//   MDETHES1
//   S <pos> <gloss> \t <word|word|...> \t <related: kind:id,...>    one line per synset; id = line number from 0
//   I <lemma> \t <id,id,...>                                       senses in order of use
// Related kinds: s = similar or "see also" (adjectives, adverbs, verbs), b = broader (hypernym), n = narrower (hyponym).
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const dict = join(dirname(require.resolve('wordnet-db/package.json')), 'dict');
const out = process.argv[2];
if (!out) throw new Error('usage: build-thesaurus.mjs <out-file>');

const FILES = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };
const MAX_NARROWER = 40;
const MAX_GLOSS = 90;

const synsets = new Map(); // "n:01234567" -> { pos, gloss, words, ptrs }
for (const [pos, name] of Object.entries(FILES)) {
  for (const line of readFileSync(join(dict, `data.${name}`), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const bar = line.indexOf(' | ');
    const head = (bar >= 0 ? line.slice(0, bar) : line).trim().split(' ');
    const gloss = bar >= 0 ? line.slice(bar + 3).trim() : '';
    const offset = head[0];
    const ssType = head[2];
    const wCnt = parseInt(head[3], 16);
    const words = [];
    let i = 4;
    for (let k = 0; k < wCnt; k++, i += 2) words.push(head[i].replace(/\([a-z]+\)$/, '').replace(/_/g, ' '));
    const pCnt = parseInt(head[i], 10);
    i++;
    const ptrs = [];
    for (let k = 0; k < pCnt; k++, i += 4) ptrs.push({ sym: head[i], target: `${head[i + 2] === 's' ? 'a' : head[i + 2]}:${head[i + 1]}` });
    synsets.set(`${pos}:${offset}`, { pos: ssType === 's' ? 'a' : ssType, gloss, words, ptrs });
  }
}

// Tagged-corpus counts (index.sense): how often each word sense occurs. Used to put common
// words first within a synset and common related synsets first.
const SS_TYPE = { 1: 'n', 2: 'v', 3: 'a', 4: 'r', 5: 'a' };
const synsetCount = new Map(); // "n:01234567" -> total count
const wordCount = new Map(); // "n:01234567:word" -> count
for (const line of readFileSync(join(dict, 'index.sense'), 'utf8').split('\n')) {
  if (!line) continue;
  const [key, offset, , count] = line.split(' ');
  const pct = key.indexOf('%');
  const pos = SS_TYPE[key[pct + 1]];
  const lemma = key.slice(0, pct).replace(/_/g, ' ');
  const n = Number(count);
  if (!n) continue;
  synsetCount.set(`${pos}:${offset}`, (synsetCount.get(`${pos}:${offset}`) ?? 0) + n);
  wordCount.set(`${pos}:${offset}:${lemma}`, n);
}

// Short gloss: the definition before any examples or second clause.
const shortGloss = (g) => {
  let s = g.split(/;\s*"/)[0].split('; ')[0].replace(/\s+/g, ' ').trim();
  if (s.length > MAX_GLOSS) s = `${s.slice(0, MAX_GLOSS - 1).replace(/\s+\S*$/, '')}…`;
  return s.replace(/\t/g, ' ');
};

const keys = [...synsets.keys()];
const ids = new Map(keys.map((k, i) => [k, i]));
const lines = ['MDETHES1'];
const byCount = (list, count) =>
  list
    .map((x, i) => ({ x, i, n: count(x) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((e) => e.x);
for (const k of keys) {
  const s = synsets.get(k);
  const related = { s: [], b: [], n: [] };
  for (const p of s.ptrs) {
    if (!ids.has(p.target)) continue;
    if ((s.pos === 'a' || s.pos === 'r') && (p.sym === '&' || p.sym === '^')) related.s.push(p.target);
    else if (s.pos === 'v' && p.sym === '^') related.s.push(p.target);
    else if ((s.pos === 'n' || s.pos === 'v') && p.sym === '@') related.b.push(p.target);
    else if ((s.pos === 'n' || s.pos === 'v') && p.sym === '~') related.n.push(p.target);
  }
  const ranked = (kind, max = Infinity) => byCount(related[kind], (t) => synsetCount.get(t) ?? 0).slice(0, max).map((t) => `${kind}:${ids.get(t)}`);
  const refs = [...ranked('s'), ...ranked('b'), ...ranked('n', MAX_NARROWER)];
  const words = byCount(s.words, (w) => wordCount.get(`${k}:${w.toLowerCase()}`) ?? 0);
  lines.push(`S ${s.pos} ${shortGloss(s.gloss)}\t${words.join('|')}\t${refs.join(',')}`);
}

// Index: lemma -> synsets in sense order; parts of speech with more tagged (frequent) senses first.
const index = new Map();
for (const [pos, name] of Object.entries(FILES)) {
  for (const line of readFileSync(join(dict, `index.${name}`), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const f = line.trim().split(' ');
    const lemma = f[0].replace(/_/g, ' ');
    const pCnt = parseInt(f[3], 10);
    const senseCnt = parseInt(f[4 + pCnt], 10);
    const tagged = parseInt(f[5 + pCnt], 10);
    const offsets = f.slice(6 + pCnt, 6 + pCnt + senseCnt);
    const entry = index.get(lemma) ?? [];
    entry.push({ pos, tagged, ids: offsets.map((o) => ids.get(`${pos}:${o}`)).filter((x) => x !== undefined) });
    index.set(lemma, entry);
  }
}
const ORDER = 'nvar';
for (const [lemma, entries] of [...index.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  entries.sort((a, b) => b.tagged - a.tagged || ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos));
  lines.push(`I ${lemma}\t${entries.flatMap((e) => e.ids).join(',')}`);
}

const text = lines.join('\n') + '\n';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, deflateSync(Buffer.from(text, 'utf8'), { level: 9 }));
const license = join(dirname(require.resolve('wordnet-db/package.json')), 'LICENSE');
if (existsSync(license)) writeFileSync(join(dirname(out), 'LICENSE-WordNet.txt'), readFileSync(license));
console.log(`Thesaurus: ${keys.length} synsets, ${index.size} lemmas, ${(text.length / 1e6).toFixed(1)} MB text, ${(statSync(out).size / 1e6).toFixed(1)} MB deflated`);
