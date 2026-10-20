// POSIX path helpers. Core cannot use node:path, and macOS paths are POSIX.

export function normalize(p: string): string {
  if (p === '') return '.';
  const absolute = p.startsWith('/');
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else {
      out.push(part);
    }
  }
  const joined = out.join('/');
  if (absolute) return `/${joined}`;
  return joined || '.';
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p !== '').join('/'));
}

export function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0) return '/';
  return n.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const n = normalize(p);
  const base = n.slice(n.lastIndexOf('/') + 1);
  if (ext && base.endsWith(ext) && base !== ext) return base.slice(0, -ext.length);
  return base;
}

/** Extension including the dot, lowercased; '' when none. */
export function extname(p: string): string {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  return base.slice(i).toLowerCase();
}

export function stripExtension(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

export function relative(from: string, to: string): string {
  const a = normalize(from).split('/').filter(Boolean);
  const b = normalize(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => '..');
  return [...up, ...b.slice(i)].join('/') || '.';
}

export function isInside(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`);
}
