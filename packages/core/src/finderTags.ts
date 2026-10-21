// macOS Finder tags. Finder stores a file's tags in the extended attribute
// com.apple.metadata:_kMDItemUserTags as a binary property list: an array of strings, each the
// tag's name, a newline and a colour digit ("Red\n6"). The library shows the colours as dots.
// Source for the format and digits: eclecticlight.co, "xattr: com.apple.metadata:_kMDItemUserTags,
// Finder tags" (2017).

export const FINDER_TAGS_ATTR = 'com.apple.metadata:_kMDItemUserTags';

export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

/** In Finder's menu order, with Finder's colour digit and the dot colour shown in the app. */
export const TAG_COLORS: ReadonlyArray<{ id: TagColor; name: string; digit: number; css: string }> = [
  { id: 'red', name: 'Red', digit: 6, css: '#ff453a' },
  { id: 'orange', name: 'Orange', digit: 7, css: '#ff9f0a' },
  { id: 'yellow', name: 'Yellow', digit: 5, css: '#ffd60a' },
  { id: 'green', name: 'Green', digit: 2, css: '#32d74b' },
  { id: 'blue', name: 'Blue', digit: 4, css: '#0a84ff' },
  { id: 'purple', name: 'Purple', digit: 3, css: '#bf5af2' },
  { id: 'gray', name: 'Gray', digit: 1, css: '#98989d' },
];

export interface FinderTag {
  name: string;
  /** 0 = no colour, 1–7 as in TAG_COLORS. */
  digit: number;
}

export function parseFinderTag(s: string): FinderTag {
  const nl = s.lastIndexOf('\n');
  if (nl === -1) return { name: s, digit: 0 };
  const digit = Number(s.slice(nl + 1));
  return { name: s.slice(0, nl), digit: Number.isInteger(digit) ? digit : 0 };
}

export function formatFinderTag(tag: FinderTag): string {
  return tag.digit ? `${tag.name}\n${tag.digit}` : tag.name;
}

/** Colours of a file's tags, in the order the tags were added, without repeats. */
export function tagColors(tags: FinderTag[]): TagColor[] {
  const out: TagColor[] = [];
  for (const t of tags) {
    const c = TAG_COLORS.find((x) => x.digit === t.digit)?.id;
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Tags after switching `color` on or off. Off removes every tag of that colour (as the dot does);
 * on adds a tag named after the colour, as Finder's default tags are.
 */
export function withTagColor(tags: FinderTag[], color: TagColor, on: boolean): FinderTag[] {
  const c = TAG_COLORS.find((x) => x.id === color)!;
  const kept = tags.filter((t) => t.digit !== c.digit);
  return on ? [...kept, { name: c.name, digit: c.digit }] : kept;
}

// ---------- Binary property lists (only what tags need: an array of strings) ----------

const MAGIC = 'bplist00';

function intBytes(n: number, size: number): number[] {
  const out: number[] = [];
  for (let i = size - 1; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
  return out;
}

function sizeFor(max: number): number {
  return max < 0x100 ? 1 : max < 0x10000 ? 2 : 4;
}

/** Marker byte plus, for 15 or more, an int object with the count. */
function countHeader(type: number, count: number): number[] {
  if (count < 15) return [type | count];
  const size = sizeFor(count);
  return [type | 0x0f, 0x10 | Math.log2(size), ...intBytes(count, size)];
}

export function encodeStringArrayPlist(strings: string[]): Uint8Array {
  const objects: number[][] = [];
  const refSize = sizeFor(strings.length + 1);
  objects.push([...countHeader(0xa0, strings.length), ...strings.flatMap((_, i) => intBytes(i + 1, refSize))]);
  for (const s of strings) {
    if (/^[\x00-\x7f]*$/.test(s)) objects.push([...countHeader(0x50, s.length), ...Array.from(s, (ch) => ch.charCodeAt(0))]);
    else {
      const units: number[] = [];
      for (let i = 0; i < s.length; i++) units.push(s.charCodeAt(i) >> 8, s.charCodeAt(i) & 0xff);
      objects.push([...countHeader(0x60, s.length), ...units]);
    }
  }
  const head = Array.from(MAGIC, (ch) => ch.charCodeAt(0));
  const offsets: number[] = [];
  const body: number[] = [];
  for (const o of objects) {
    offsets.push(head.length + body.length);
    body.push(...o);
  }
  const tableOffset = head.length + body.length;
  const offsetSize = sizeFor(tableOffset);
  const table = offsets.flatMap((o) => intBytes(o, offsetSize));
  const trailer = [0, 0, 0, 0, 0, 0, offsetSize, refSize, ...intBytes(objects.length, 8), ...intBytes(0, 8), ...intBytes(tableOffset, 8)];
  return new Uint8Array([...head, ...body, ...table, ...trailer]);
}

/** The strings of a binary plist holding an array of strings; null when it is anything else. */
export function decodeStringArrayPlist(bytes: Uint8Array): string[] | null {
  if (bytes.length < 40 || String.fromCharCode(...bytes.subarray(0, 8)) !== MAGIC) return null;
  const readInt = (at: number, size: number) => {
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + bytes[at + i];
    return n;
  };
  const t = bytes.length - 32;
  const offsetSize = bytes[t + 6];
  const refSize = bytes[t + 7];
  const count = readInt(t + 8, 8);
  const top = readInt(t + 16, 8);
  const tableOffset = readInt(t + 24, 8);
  if (!offsetSize || !refSize || top >= count || tableOffset + count * offsetSize > t) return null;
  const offsetOf = (i: number) => readInt(tableOffset + i * offsetSize, offsetSize);
  /** Length of a counted object and where its data starts. */
  const lengthAt = (at: number): [number, number] => {
    const low = bytes[at] & 0x0f;
    if (low !== 0x0f) return [low, at + 1];
    const size = 1 << (bytes[at + 1] & 0x0f);
    return [readInt(at + 2, size), at + 2 + size];
  };
  const stringAt = (i: number): string | null => {
    if (i >= count) return null;
    const at = offsetOf(i);
    const type = bytes[at] & 0xf0;
    const [len, start] = lengthAt(at);
    if (type === 0x50) return String.fromCharCode(...bytes.subarray(start, start + len));
    if (type === 0x60) {
      let s = '';
      for (let k = 0; k < len; k++) s += String.fromCharCode((bytes[start + 2 * k] << 8) | bytes[start + 2 * k + 1]);
      return s;
    }
    return null;
  };
  const at = offsetOf(top);
  if ((bytes[at] & 0xf0) !== 0xa0) return null;
  const [len, start] = lengthAt(at);
  const out: string[] = [];
  for (let k = 0; k < len; k++) {
    const s = stringAt(readInt(start + k * refSize, refSize));
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

export function decodeFinderTags(bytes: Uint8Array | null): FinderTag[] {
  return bytes ? (decodeStringArrayPlist(bytes) ?? []).map(parseFinderTag) : [];
}

export function encodeFinderTags(tags: FinderTag[]): Uint8Array {
  return encodeStringArrayPlist(tags.map(formatFinderTag));
}
