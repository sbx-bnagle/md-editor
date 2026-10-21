// Small filled circles for menu items (Finder tag colours). Electron menus take bitmap images,
// so the circle is drawn into a PNG here.

import { deflateSync } from 'node:zlib';
import { nativeImage, type NativeImage } from 'electron';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An RGBA PNG of a filled circle with smooth edges. */
function circlePng(hex: string, size: number): Buffer {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rows: Buffer[] = [];
  const c = size / 2;
  const radius = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      row.set([r, g, b, Math.round(alpha * 255)], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const cache = new Map<string, NativeImage>();

/** A 12-point dot, drawn at twice the size for Retina screens. */
export function dotIcon(hex: string): NativeImage {
  let img = cache.get(hex);
  if (!img) {
    img = nativeImage.createFromBuffer(circlePng(hex, 24), { scaleFactor: 2 });
    cache.set(hex, img);
  }
  return img;
}
