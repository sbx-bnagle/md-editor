// Version history pack format: one append-only file per project (.mdeditor/history.mdh).
// A single file syncs more reliably through iCloud Drive / Dropbox than a git object
// store of thousands of small files.
//
// File   = MAGIC record*
// Record = type:u8  length:u32be  payload  crc32(type+payload):u32be
// type 1 = blob:     sha256 (32 bytes) + deflate(content)
// type 2 = snapshot: deflate(JSON SnapshotRecord)
//
// File contents are content-addressed, so unchanged files and images are stored once.
// A truncated or corrupt tail (e.g. interrupted write) is ignored on read.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { crc32 } from './hash';

export const HISTORY_MAGIC = strToU8('MDEHIST1\n');
export const RECORD_BLOB = 1;
export const RECORD_SNAPSHOT = 2;

export type SnapshotKind = 'auto' | 'checkpoint' | 'export' | 'restore';

export interface SnapshotFile {
  /** sha256 hex of the content. */
  h: string;
  /** Size in bytes. */
  s: number;
}

export interface SnapshotRecord {
  id: string;
  time: number;
  kind: SnapshotKind;
  name?: string;
  parent?: string;
  /** Project-relative POSIX paths. */
  files: Record<string, SnapshotFile>;
}

export interface PackIndex {
  /** Blob hash -> location of the compressed payload in the file. */
  blobs: Map<string, { offset: number; length: number }>;
  snapshots: SnapshotRecord[];
  /** Byte length of the valid prefix; anything after it is a damaged tail. */
  validLength: number;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encodeRecord(type: number, payload: Uint8Array): Uint8Array {
  const typed = concat([new Uint8Array([type]), payload]);
  return concat([new Uint8Array([type]), u32(payload.length), payload, u32(crc32(typed))]);
}

export function encodeBlobRecord(hash: string, content: Uint8Array): Uint8Array {
  return encodeRecord(RECORD_BLOB, concat([hexToBytes(hash), deflateSync(content, { level: 6 })]));
}

export function encodeSnapshotRecord(s: SnapshotRecord): Uint8Array {
  return encodeRecord(RECORD_SNAPSHOT, deflateSync(strToU8(JSON.stringify(s))));
}

/**
 * Indexes a pack. `bytes` may be the whole file or only its record headers being read
 * incrementally; blob payloads are located, not decompressed.
 */
export function indexPack(bytes: Uint8Array): PackIndex {
  const index: PackIndex = { blobs: new Map(), snapshots: [], validLength: 0 };
  if (bytes.length < HISTORY_MAGIC.length) return index;
  for (let i = 0; i < HISTORY_MAGIC.length; i++) if (bytes[i] !== HISTORY_MAGIC[i]) throw new Error('Not a history file.');
  let o = HISTORY_MAGIC.length;
  index.validLength = o;
  while (o + 5 <= bytes.length) {
    const type = bytes[o];
    const len = readU32(bytes, o + 1);
    const end = o + 5 + len + 4;
    if (end > bytes.length) break;
    const payload = bytes.subarray(o + 5, o + 5 + len);
    const typed = concat([new Uint8Array([type]), payload]);
    if (crc32(typed) !== readU32(bytes, o + 5 + len)) break;
    if (type === RECORD_BLOB) {
      const hash = bytesToHex(payload.subarray(0, 32));
      if (!index.blobs.has(hash)) index.blobs.set(hash, { offset: o + 5 + 32, length: len - 32 });
    } else if (type === RECORD_SNAPSHOT) {
      try {
        index.snapshots.push(JSON.parse(strFromU8(inflateSync(payload))) as SnapshotRecord);
      } catch {
        break;
      }
    }
    o = end;
    index.validLength = o;
  }
  return index;
}

export function decodeBlob(compressed: Uint8Array): Uint8Array {
  return inflateSync(compressed);
}

export function newSnapshotId(time: number, rand: () => number = Math.random): string {
  return `${time.toString(36)}-${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

export interface SnapshotChange {
  path: string;
  status: 'added' | 'removed' | 'modified';
}

/** Changes from `before` to `after`. */
export function compareSnapshots(
  before: Record<string, SnapshotFile> | undefined,
  after: Record<string, SnapshotFile>,
): SnapshotChange[] {
  const out: SnapshotChange[] = [];
  const prev = before ?? {};
  for (const [p, f] of Object.entries(after)) {
    if (!prev[p]) out.push({ path: p, status: 'added' });
    else if (prev[p].h !== f.h) out.push({ path: p, status: 'modified' });
  }
  for (const p of Object.keys(prev)) if (!after[p]) out.push({ path: p, status: 'removed' });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function sameFiles(a: Record<string, SnapshotFile> | undefined, b: Record<string, SnapshotFile>): boolean {
  return !!a && compareSnapshots(a, b).length === 0;
}

/** Binary heuristic: NUL byte in the first 8 KB. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}
