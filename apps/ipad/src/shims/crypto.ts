// node:crypto for the backend in the web view: random bytes only.

import { BufferLike } from './buffer';

export function randomBytes(size: number): BufferLike {
  const out = new BufferLike(size);
  crypto.getRandomValues(out);
  return out;
}

export default { randomBytes };
