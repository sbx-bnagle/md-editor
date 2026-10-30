// The part of Node's Buffer the backend uses on file contents and random bytes: a Uint8Array
// whose toString takes an encoding.

import { toBase64 } from '../base64';

export type BufferEncoding = 'utf8' | 'utf-8' | 'base64' | 'hex' | 'latin1' | 'binary';

const utf8 = new TextDecoder();

export class BufferLike extends Uint8Array {
  static fromBytes(bytes: Uint8Array): BufferLike {
    return new BufferLike(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  }

  override toString(encoding: BufferEncoding = 'utf8'): string {
    return decode(this, encoding);
  }
}

export function decode(bytes: Uint8Array, encoding: BufferEncoding): string {
  switch (encoding) {
    case 'base64':
      return toBase64(bytes);
    case 'hex':
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    case 'latin1':
    case 'binary': {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return s;
    }
    default:
      return utf8.decode(bytes);
  }
}
