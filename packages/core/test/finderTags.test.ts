import { describe, expect, test } from 'vitest';
import { decodeFinderTags, decodeStringArrayPlist, encodeStringArrayPlist, tagColors, withTagColor } from '../src/finderTags';

// Made with Python's plistlib (FMT_BINARY), the reference for the format.
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
const ONE = '62706c6973743030a101555265640a36080a0000000000000101000000000000000200000000000000000000000000000010';
const MIXED =
  '62706c6973743030a3010203555265640a365950726f6a656b740a346900dc006e00ef0063006f00640065000a0032080c121c000000000000010100000000000000040000000000000000000000000000002f';
const SHARED = '62706c6973743030af1014010101010101010101010101010101010101010153610a30081f0000000000000101000000000000000200000000000000000000000000000023';

describe('Finder tags', () => {
  test('binary property lists match plistlib', () => {
    expect(decodeStringArrayPlist(fromHex(ONE))).toEqual(['Red\n6']);
    expect(decodeStringArrayPlist(fromHex(MIXED))).toEqual(['Red\n6', 'Projekt\n4', 'Ünïcode\n2']);
    expect(decodeStringArrayPlist(fromHex(SHARED))).toEqual(Array(20).fill('a\n0'));
    expect(Buffer.from(encodeStringArrayPlist(['Red\n6'])).toString('hex')).toBe(ONE);
    expect(Buffer.from(encodeStringArrayPlist(['Red\n6', 'Projekt\n4', 'Ünïcode\n2'])).toString('hex')).toBe(MIXED);
    const many = Array.from({ length: 20 }, (_, i) => `Tag ${i}\n${i % 8}`);
    expect(decodeStringArrayPlist(encodeStringArrayPlist(many))).toEqual(many);
    expect(decodeStringArrayPlist(new TextEncoder().encode('not a plist at all, not at all, not at all'))).toBeNull();
  });

  test('colours on and off', () => {
    const tags = decodeFinderTags(fromHex(MIXED));
    expect(tagColors(tags)).toEqual(['red', 'blue', 'green']);
    expect(tagColors(withTagColor(tags, 'red', false))).toEqual(['blue', 'green']);
    expect(withTagColor(tags, 'orange', true).at(-1)).toEqual({ name: 'Orange', digit: 7 });
    // Turning a colour off removes custom-named tags of that colour too.
    expect(withTagColor(tags, 'blue', false).map((t) => t.name)).toEqual(['Red', 'Ünïcode']);
  });
});
