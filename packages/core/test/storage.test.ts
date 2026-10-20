import { describe, expect, test } from 'vitest';
import { blockToSpans, serializeWithAnnotations, splitAnnotations } from '../src/annotations';
import {
  HISTORY_MAGIC,
  compareSnapshots,
  decodeBlob,
  encodeBlobRecord,
  encodeSnapshotRecord,
  indexPack,
  type SnapshotRecord,
} from '../src/history';
import { sha256Hex, utf8 } from '../src/hash';

describe('annotations', () => {
  test('round trip with grapheme clusters', () => {
    const text = 'Hi 👍🏽 there, family 👨‍👩‍👧 done.\n';
    const human = { author: '@Writer', from: 0, to: text.indexOf('family') };
    const ai = { author: '&Claude', from: text.indexOf('family'), to: text.length - 1 };
    const file = serializeWithAnnotations(text, [human, ai]);
    expect(file.startsWith(`${text}\n---\nAnnotations: 0,`)).toBe(true);
    const back = splitAnnotations(file);
    expect(back.valid).toBe(true);
    expect(back.text).toBe(text);
    expect(back.block!.authors.map((a) => [a.key, a.kind, a.name])).toEqual([
      ['@Writer', 'human', 'Writer'],
      ['&Claude', 'ai', 'Claude'],
    ]);
    // Emoji with modifiers and ZWJ sequences count as one grapheme each.
    expect(back.block!.authors[0].ranges).toEqual([[0, 12]]);
    expect(blockToSpans(back.text, back.block!)).toEqual([human, ai]);
  });

  test('edited text invalidates the hash', () => {
    const file = serializeWithAnnotations('abc\n', [{ author: '@A', from: 0, to: 3 }]);
    const edited = file.replace('abc', 'abd');
    expect(splitAnnotations(edited).valid).toBe(false);
  });

  test('files without a block are untouched', () => {
    const r = splitAnnotations('Text\n\n---\n\nMore\n...\n');
    expect(r.block).toBeNull();
    expect(serializeWithAnnotations('x', [])).toBe('x');
  });

  test('preserves unknown annotations and escaped colons in keys', () => {
    const file = 'T\n\n---\nAnnotations: 0,2 SHA-256 ' + sha256Hex('T\n').slice(0, 20) + '\n@Name\\: Jr: 0\nNote: kept value\n...\n';
    const r = splitAnnotations(file);
    expect(r.valid).toBe(true);
    expect(r.block!.authors[0].key).toBe('@Name: Jr');
    expect(r.block!.other).toEqual([{ key: 'Note', value: 'kept value' }]);
  });
});

describe('history pack', () => {
  test('encode, index, decode, truncated tail', () => {
    const content = utf8('# Hello\n');
    const h = sha256Hex(content);
    const snap: SnapshotRecord = { id: 's1', time: 1, kind: 'checkpoint', name: 'First', files: { 'main.md': { h, s: content.length } } };
    const parts = [HISTORY_MAGIC, encodeBlobRecord(h, content), encodeSnapshotRecord(snap)];
    const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      file.set(p, o);
      o += p.length;
    }
    const idx = indexPack(file);
    expect(idx.snapshots).toEqual([snap]);
    expect(idx.validLength).toBe(file.length);
    const loc = idx.blobs.get(h)!;
    expect(new TextDecoder().decode(decodeBlob(file.subarray(loc.offset, loc.offset + loc.length)))).toBe('# Hello\n');

    const truncated = file.subarray(0, file.length - 3);
    const idx2 = indexPack(truncated);
    expect(idx2.snapshots).toEqual([]);
    expect(idx2.blobs.has(h)).toBe(true);
  });

  test('compare snapshots', () => {
    expect(
      compareSnapshots({ a: { h: '1', s: 1 }, b: { h: '2', s: 1 } }, { a: { h: '1', s: 1 }, b: { h: '3', s: 1 }, c: { h: '4', s: 1 } }),
    ).toEqual([
      { path: 'b', status: 'modified' },
      { path: 'c', status: 'added' },
    ]);
  });
});
