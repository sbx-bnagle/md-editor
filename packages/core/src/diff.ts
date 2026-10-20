import { diffLines, diffWordsWithSpace } from 'diff';

export interface DiffPart {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  text: string;
  oldNo?: number;
  newNo?: number;
  /** Word-level detail for modified lines. */
  parts?: DiffPart[];
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

function splitLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Line diff with word highlighting for paired deletions/additions, grouped into hunks. */
export function computeDiff(before: string, after: string, context = 3): DiffHunk[] {
  const all: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  const changes = diffLines(before, after);
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const lines = splitLines(c.value);
    if (c.removed && changes[i + 1]?.added) {
      const added = splitLines(changes[i + 1].value);
      const n = Math.max(lines.length, added.length);
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      for (let k = 0; k < n; k++) {
        const a = lines[k];
        const b = added[k];
        if (a !== undefined && b !== undefined) {
          const words = diffWordsWithSpace(a, b);
          dels.push({ type: 'del', text: a, oldNo: oldNo++, parts: words.filter((w) => !w.added).map((w) => ({ text: w.value, changed: !!w.removed })) });
          adds.push({ type: 'add', text: b, newNo: newNo++, parts: words.filter((w) => !w.removed).map((w) => ({ text: w.value, changed: !!w.added })) });
        } else if (a !== undefined) dels.push({ type: 'del', text: a, oldNo: oldNo++ });
        else if (b !== undefined) adds.push({ type: 'add', text: b, newNo: newNo++ });
      }
      all.push(...dels, ...adds);
      i++;
      continue;
    }
    for (const text of lines) {
      if (c.added) all.push({ type: 'add', text, newNo: newNo++ });
      else if (c.removed) all.push({ type: 'del', text, oldNo: oldNo++ });
      else all.push({ type: 'context', text, oldNo: oldNo++, newNo: newNo++ });
    }
  }

  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let lastChange = -Infinity;
  const nextChange = new Array<number>(all.length + 1).fill(-1);
  for (let i = all.length - 1; i >= 0; i--) nextChange[i] = all[i + 1] && all[i + 1].type !== 'context' ? i + 1 : nextChange[i + 1];
  for (let i = 0; i < all.length; i++) {
    if (all[i].type === 'context') continue;
    const from = Math.max(0, i - context, lastChange + context + 1);
    if (!current || i - lastChange > context * 2) {
      current = { oldStart: all[from].oldNo ?? 0, newStart: all[from].newNo ?? 0, lines: [] };
      hunks.push(current);
      for (let k = from; k < i; k++) current.lines.push(all[k]);
    } else {
      for (let k = lastChange + 1; k < i; k++) current.lines.push(all[k]);
    }
    current.lines.push(all[i]);
    lastChange = i;
    const next = nextChange[i];
    if (next === -1 || next - i > context * 2) {
      for (let k = i + 1; k <= Math.min(all.length - 1, i + context); k++) current.lines.push(all[k]);
    }
  }
  return hunks;
}
