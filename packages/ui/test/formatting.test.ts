import { describe, expect, test } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { GFM, parser } from '@lezer/markdown';
import { formatChange, type FormatKind } from '../src/editor/formatting';
import { MarkedText } from '../src/editor/markedText';

/** Applies a format to `text`, where [ ] marks the selection and | a cursor. */
function apply(text: string, kind: FormatKind): string {
  const ranges: Array<[number, number]> = [];
  let doc = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '|') ranges.push([doc.length, doc.length]);
    else if (c === '[') ranges.push([doc.length, -1]);
    else if (c === ']') ranges[ranges.length - 1][1] = doc.length;
    else doc += c;
  }
  const state = EditorState.create({ doc, selection: EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b))), extensions: EditorState.allowMultipleSelections.of(true) });
  const next = state.update(formatChange(state, kind)).state;
  let out = next.doc.toString();
  const marks = next.selection.ranges.flatMap((r) =>
    r.empty
      ? [[r.from, '|']]
      : [
          [r.to, ']'],
          [r.from, '['],
        ],
  ) as Array<[number, string]>;
  for (const [pos, m] of marks.sort((a, b) => b[0] - a[0] || (a[1] === '[' ? 1 : -1))) out = out.slice(0, pos) + m + out.slice(pos);
  return out;
}

describe('⌘B, ⌘I, ⌘M', () => {
  test('wrap a selection, and unwrap it again', () => {
    expect(apply('a [word] b', 'bold')).toBe('a **[word]** b');
    expect(apply('a **[word]** b', 'bold')).toBe('a [word] b');
    expect(apply('a [**word**] b', 'bold')).toBe('a [word] b');
    expect(apply('a [word] b', 'italic')).toBe('a *[word]* b');
    expect(apply('a *[word]* b', 'italic')).toBe('a [word] b');
    expect(apply('a [word] b', 'mark')).toBe('a ==[word]== b');
    expect(apply('a ==[word]== b', 'mark')).toBe('a [word] b');
  });

  test('bold and italic combine and come off separately', () => {
    expect(apply('**[word]**', 'italic')).toBe('***[word]***');
    expect(apply('***[word]***', 'bold')).toBe('*[word]*');
    expect(apply('***[word]***', 'italic')).toBe('**[word]**');
    expect(apply('*[word]*', 'bold')).toBe('***[word]***');
  });

  test('any format comes off, whichever markers are inside it', () => {
    expect(apply('***==[two]==***', 'bold')).toBe('*==[two]==*');
    expect(apply('***==[two]==***', 'italic')).toBe('**==[two]==**');
    expect(apply('*==[two]==*', 'mark')).toBe('*[two]*');
    expect(apply('==**[two]**==', 'mark')).toBe('**[two]**');
    expect(apply('[***==two==***]', 'bold')).toBe('[*==two==*]');
    expect(apply('[==**two**==]', 'bold')).toBe('[==two==]');
    // Unmatched layers are not a pair: the format is added.
    expect(apply('**==[two]', 'bold')).toBe('**==**[two]**');
  });

  test('a cursor in a word formats the word; elsewhere it gets a pair of markers', () => {
    expect(apply('a wo|rd b', 'bold')).toBe('a **wo|rd** b');
    expect(apply('a **wo|rd** b', 'bold')).toBe('a wo|rd b');
    expect(apply('a | b', 'mark')).toBe('a ==|== b');
    expect(apply('a ==|== b', 'mark')).toBe('a | b');
  });

  test('every selection', () => {
    expect(apply('[one] two [one]', 'bold')).toBe('**[one]** two **[one]**');
  });
});

describe('==marked text== in the editor', () => {
  const md = parser.configure([GFM, MarkedText]);
  const names = (text: string) => {
    const out: string[] = [];
    md.parse(text).iterate({ enter: (n) => void out.push(n.name) });
    return out;
  };
  test('parsed as Marked with its marks', () => {
    expect(names('A ==marked== word.')).toEqual(expect.arrayContaining(['Marked', 'MarkedMark']));
    expect(names('a == b, and x ==y')).not.toContain('Marked');
    expect(names('`==code==`')).not.toContain('Marked');
  });
});
