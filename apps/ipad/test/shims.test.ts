import { describe, expect, it } from 'vitest';
import { posix } from 'node:path';
import * as path from '../src/shims/path';
import { BufferLike } from '../src/shims/buffer';
import { randomBytes } from '../src/shims/crypto';

const samples = [
  '', '/', '//', '.', '..', 'a', '/a', 'a/', '/a/', '/a/b', 'a/b/', '/a//b', '/a/./b', '/a/../b', '/a/b/..', '/a/b/../..', '/a/b/../../..',
  '../a', 'a/../..', './a', 'a/.', '/a/b.md', '/a/b.tar.gz', '/a/.hidden', '/a/.hidden.md', '/a/b.', '/a/..md', '/Folio Dome Library/Collections/Ex/p.md',
  '/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Lib', 'x/y/z', '/x/y/z/', '/ä/ö.md',
];

describe('path stand-in (POSIX, as Node)', () => {
  it('matches node:path for single paths', () => {
    for (const p of samples) {
      expect(path.normalize(p), `normalize(${p})`).toBe(posix.normalize(p));
      expect(path.dirname(p), `dirname(${p})`).toBe(posix.dirname(p));
      expect(path.basename(p), `basename(${p})`).toBe(posix.basename(p));
      expect(path.basename(p, '.md'), `basename(${p}, .md)`).toBe(posix.basename(p, '.md'));
      expect(path.extname(p), `extname(${p})`).toBe(posix.extname(p));
      expect(path.isAbsolute(p), `isAbsolute(${p})`).toBe(posix.isAbsolute(p));
    }
  });

  it('matches node:path for pairs (join, relative, resolve from /)', () => {
    const abs = samples.filter((p) => p.startsWith('/'));
    for (const a of samples) {
      for (const b of samples) {
        expect(path.join(a, b), `join(${a}, ${b})`).toBe(posix.join(a, b));
      }
    }
    for (const a of abs) {
      for (const b of abs) {
        expect(path.relative(a, b), `relative(${a}, ${b})`).toBe(posix.relative(a, b));
        expect(path.resolve(a, b), `resolve(${a}, ${b})`).toBe(posix.resolve(a, b));
      }
      expect(path.resolve(a, 'x', '../y'), `resolve(${a}, x, ../y)`).toBe(posix.resolve(a, 'x', '../y'));
    }
    expect(path.sep).toBe('/');
  });
});

describe('Buffer and crypto stand-ins', () => {
  it('encodes like Buffer', () => {
    const bytes = BufferLike.fromBytes(new Uint8Array([0, 1, 127, 128, 255, 0x68, 0x69]));
    const node = Buffer.from([0, 1, 127, 128, 255, 0x68, 0x69]);
    for (const enc of ['base64', 'hex', 'latin1'] as const) expect(bytes.toString(enc)).toBe(node.toString(enc));
    const text = new TextEncoder().encode('“quotes” — ✓');
    expect(BufferLike.fromBytes(text).toString()).toBe('“quotes” — ✓');
    expect(BufferLike.fromBytes(text).toString('base64')).toBe(Buffer.from(text).toString('base64'));
  });

  it('gives random bytes as hex', () => {
    const r = randomBytes(6).toString('hex');
    expect(r).toMatch(/^[0-9a-f]{12}$/);
    expect(randomBytes(6).toString('hex')).not.toBe(r);
  });
});
