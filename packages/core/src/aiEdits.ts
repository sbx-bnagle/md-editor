// Changes the Assistant proposes to project files. A reply carries them in fenced blocks:
//
//   ````edit file="chapters/intro.md"
//   <<<<<<< SEARCH
//   text copied from the file
//   =======
//   the new text
//   >>>>>>> REPLACE
//   ````
//
//   ````create file="notes/summary.md"
//   the whole new file
//   ````
//
// The writer reviews each one and applies it. ```insert blocks (text for the cursor) are parsed
// here too, so a reply is split once into text and blocks.

import { normalize } from './paths';
import { META_DIR } from './library';

export interface EditPair {
  search: string;
  replace: string;
}

export type ReplySegment =
  | { type: 'text'; text: string }
  | { type: 'insert'; text: string; complete: boolean }
  | { type: 'edit'; file: string; pairs: EditPair[]; complete: boolean }
  | { type: 'create'; file: string; content: string; complete: boolean };

const FENCE = /^(`{3,})(insert|edit|create)\b(.*)$/;

function attr(rest: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(rest);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
}

/** SEARCH/REPLACE pairs in an edit block's body. */
export function parseEditPairs(body: string): EditPair[] {
  const pairs: EditPair[] = [];
  const lines = body.split('\n');
  let mode: 'none' | 'search' | 'replace' = 'none';
  let search: string[] = [];
  let replace: string[] = [];
  for (const line of lines) {
    if (/^<{5,}\s*SEARCH\s*$/.test(line)) {
      mode = 'search';
      search = [];
      replace = [];
    } else if (mode === 'search' && /^={5,}\s*$/.test(line)) mode = 'replace';
    else if (mode === 'replace' && /^>{5,}\s*REPLACE\s*$/.test(line)) {
      pairs.push({ search: search.join('\n'), replace: replace.join('\n') });
      mode = 'none';
    } else if (mode === 'search') search.push(line);
    else if (mode === 'replace') replace.push(line);
  }
  return pairs;
}

/**
 * Splits a reply into text and blocks. A fence closes with a line of at least as many backticks;
 * a block still being written (no closing fence yet) is returned with complete: false.
 */
export function parseReply(reply: string): ReplySegment[] {
  const out: ReplySegment[] = [];
  const lines = reply.split('\n');
  let text: string[] = [];
  const flushText = () => {
    const t = text.join('\n');
    if (t.trim()) out.push({ type: 'text', text: t.trim() });
    text = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]);
    if (!open) {
      text.push(lines[i]);
      continue;
    }
    flushText();
    const ticks = open[1].length;
    const close = new RegExp(`^\`{${ticks},}\\s*$`);
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
    const complete = j < lines.length;
    const content = body.join('\n');
    const kind = open[2];
    if (kind === 'insert') out.push({ type: 'insert', text: content, complete });
    else if (kind === 'edit') out.push({ type: 'edit', file: attr(open[3], 'file'), pairs: parseEditPairs(content), complete });
    else out.push({ type: 'create', file: attr(open[3], 'file'), content, complete });
    i = j;
  }
  flushText();
  return out;
}

/** Characters that differ between typed and model-written text but read the same: compared as equal. */
const SAME: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', ' ': ' ', '‑': '-' };
const fold = (s: string) => s.replace(/[‘’“” ‑]/g, (c) => SAME[c]);

export type EditLocation = { from: number; to: number } | { problem: 'missing' | 'ambiguous' | 'empty' };

/** Where `search` is in `text`: exactly once, comparing curly and straight quotes as equal. */
export function locateEdit(text: string, search: string): EditLocation {
  if (!search) return { problem: 'empty' };
  const hay = fold(text);
  const needle = fold(search);
  const at = hay.indexOf(needle);
  if (at < 0) return { problem: 'missing' };
  if (hay.indexOf(needle, at + 1) >= 0) return { problem: 'ambiguous' };
  return { from: at, to: at + search.length };
}

export type PairStatus = 'ready' | 'applied' | 'missing' | 'ambiguous';

/** Whether a pair can be applied to `text`, or looks applied already (its replacement is there, its search text is not). */
export function pairStatus(text: string, pair: EditPair): PairStatus {
  const at = locateEdit(text, pair.search);
  if ('from' in at) return 'ready';
  if (at.problem === 'ambiguous') return 'ambiguous';
  if (pair.replace && 'from' in locateEdit(text, pair.replace)) return 'applied';
  if (!pair.replace && at.problem === 'missing') return 'applied';
  return 'missing';
}

/** A file named in a block, as a path inside `root`, or null when it points outside it or into META_DIR. */
export function resolveEditPath(root: string, file: string): string | null {
  const rel = normalize(file.replace(/^\.\//, ''));
  if (!file || file.startsWith('/') || rel === '.' || rel === '..' || rel.startsWith('../') || rel === META_DIR || rel.startsWith(`${META_DIR}/`)) return null;
  return `${root}/${rel}`;
}

/** Instructions for proposing changes, added to the chat system prompt. */
export const EDIT_INSTRUCTIONS = [
  'You can change the project’s files. The writer reviews each change and applies it with a click, so propose changes as blocks rather than describing them:',
  '- To change part of a file, use an edit block. Copy the SEARCH text exactly from the file, with enough of it to occur only once; put the new text after =======. A block can hold several SEARCH/REPLACE pairs for the same file. To delete text, leave the part after ======= empty.',
  '````edit file="chapters/intro.md"\n<<<<<<< SEARCH\ntext copied exactly from the file\n=======\nthe new text\n>>>>>>> REPLACE\n````',
  '- To create a file, use a create block with its whole content: ````create file="notes/summary.md"````.',
  'File paths are relative to the project folder. Use four backticks for these fences, so that code in the text cannot close them. Keep the explanation short and do not repeat the change outside the block.',
].join('\n');
