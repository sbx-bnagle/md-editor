import { describe, expect, test } from 'vitest';
import { chatSystemPrompt, projectFilesSystemNote, type WritingContext } from '../src/ai';
import { locateEdit, pairStatus, parseReply, resolveEditPath } from '../src/aiEdits';

describe('changes the Assistant proposes', () => {
  test('a reply splits into text, insert, edit and create blocks', () => {
    const reply = [
      'Two changes:',
      '````edit file="chapters/intro.md"',
      '<<<<<<< SEARCH',
      'Old line one.',
      'Old line two.',
      '=======',
      'New line.',
      '>>>>>>> REPLACE',
      '<<<<<<< SEARCH',
      'Delete me.',
      '=======',
      '>>>>>>> REPLACE',
      '````',
      'And a new file:',
      "````create file='notes/summary.md'",
      '# Summary',
      '',
      '```js',
      'code();',
      '```',
      '````',
      '```insert',
      'A draft.',
      '```',
    ].join('\n');
    expect(parseReply(reply)).toEqual([
      { type: 'text', text: 'Two changes:' },
      {
        type: 'edit',
        file: 'chapters/intro.md',
        complete: true,
        pairs: [
          { search: 'Old line one.\nOld line two.', replace: 'New line.' },
          { search: 'Delete me.', replace: '' },
        ],
      },
      { type: 'text', text: 'And a new file:' },
      { type: 'create', file: 'notes/summary.md', complete: true, content: '# Summary\n\n```js\ncode();\n```' },
      { type: 'insert', text: 'A draft.', complete: true },
    ]);
  });

  test('a block still being written is incomplete', () => {
    expect(parseReply('````edit file="a.md"\n<<<<<<< SEARCH\nx')).toEqual([{ type: 'edit', file: 'a.md', pairs: [], complete: false }]);
  });

  test('found once, with curly and straight quotes compared as equal', () => {
    const text = 'She said “hello” and it’s fine. Twice: fine.';
    expect(locateEdit(text, 'said "hello" and it\'s')).toEqual({ from: 4, to: 25 });
    expect(locateEdit(text, 'fine')).toEqual({ problem: 'ambiguous' });
    expect(locateEdit(text, 'goodbye')).toEqual({ problem: 'missing' });
    expect(locateEdit(text, '')).toEqual({ problem: 'empty' });
  });

  test('status: ready, applied already, or not applicable', () => {
    expect(pairStatus('A b c.', { search: 'b', replace: 'B' })).toBe('ready');
    expect(pairStatus('A B c.', { search: 'b', replace: 'B' })).toBe('applied');
    // A deletion that is not there cannot be told from one that was applied.
    expect(pairStatus('A c.', { search: 'b', replace: '' })).toBe('missing');
    // A replacement that keeps its search text is applied once it is there, and not again.
    expect(pairStatus('## Variables\nText.', { search: '## Variables', replace: '## Variables and values' })).toBe('ready');
    expect(pairStatus('## Variables and values\nText.', { search: '## Variables', replace: '## Variables and values' })).toBe('applied');
    expect(pairStatus('A x c.', { search: 'b', replace: 'B' })).toBe('missing');
    expect(pairStatus('b b', { search: 'b', replace: 'B' })).toBe('ambiguous');
  });

  test('paths stay inside the project and out of its metadata', () => {
    expect(resolveEditPath('/lib/P', 'chapters/a.md')).toBe('/lib/P/chapters/a.md');
    expect(resolveEditPath('/lib/P', './a.md')).toBe('/lib/P/a.md');
    expect(resolveEditPath('/lib/P', '../Q/a.md')).toBeNull();
    expect(resolveEditPath('/lib/P', 'a/../../x.md')).toBeNull();
    expect(resolveEditPath('/lib/P', '/etc/passwd')).toBeNull();
    expect(resolveEditPath('/lib/P', '.mdeditor/project.json')).toBeNull();
    expect(resolveEditPath('/lib/P', '.MDEditor/project.json')).toBeNull();
    expect(resolveEditPath('/lib/P', 'x/../.Mdeditor/chat.json')).toBeNull();
    expect(resolveEditPath('/lib', 'Collections/C/P/.mdeditor/project.json')).toBeNull();
    expect(resolveEditPath('/lib/P', 'chapters/.mdeditor/project.json')).toBeNull();
    expect(resolveEditPath('/lib/P', '')).toBeNull();
  });

  test('the prompt explains the blocks and names the open document’s path', () => {
    const ctx = { voice: null, style: null } as unknown as WritingContext;
    const prompt = chatSystemPrompt(ctx, { name: 'intro.md', path: 'chapters/intro.md', text: 'Hi.' }, '', true);
    expect(prompt).toContain('````edit file=');
    expect(prompt).toContain('<document name="intro.md" path="chapters/intro.md">');
    expect(chatSystemPrompt(ctx, null, '')).not.toContain('````edit');
    expect(projectFilesSystemNote([], [])).toBe('');
  });
});

describe('replies from servers', () => {
  test('Windows line endings in a reply still give blocks', () => {
    const reply = 'Here.\r\n````edit file="a.md"\r\n<<<<<<< SEARCH\r\nold\r\n=======\r\nnew\r\n>>>>>>> REPLACE\r\n````\r\n';
    expect(parseReply(reply)).toEqual([
      { type: 'text', text: 'Here.' },
      { type: 'edit', file: 'a.md', pairs: [{ search: 'old', replace: 'new' }], complete: true },
    ]);
  });

  test('names in prompt tags are escaped', async () => {
    const { promptAttr } = await import('../src/ai');
    expect(promptAttr('a"b <x>.txt')).toBe('a&quot;b &lt;x&gt;.txt');
  });
});

describe('voice guide replies', () => {
  test('the guide is taken from the reply, without an introduction; an empty reply gives nothing', async () => {
    const { voiceGuideFromReply } = await import('../src/ai');
    expect(voiceGuideFromReply('# Voice\n\nShort.\n')).toBe('# Voice\n\nShort.\n');
    expect(voiceGuideFromReply('Sure! Here is the revised guide:\n\n# Voice\n\nShort.')).toBe('# Voice\n\nShort.\n');
    expect(voiceGuideFromReply('Here it is:\n```markdown\n# Voice\n\nShort.\n```')).toBe('# Voice\n\nShort.\n');
    expect(voiceGuideFromReply('')).toBe('');
    expect(voiceGuideFromReply('   \n')).toBe('');
  });
});
