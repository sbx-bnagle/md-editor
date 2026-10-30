// URLs for local files referenced by documents and themes (images, fonts).
// The host serves this scheme and must only serve files inside allowed roots.

export const ASSET_SCHEME = 'mde-asset';
let PREFIX = `${ASSET_SCHEME}://local`;

/** Where asset URLs point: the desktop app's own scheme, or (web app) a same-origin address its service worker serves. */
export function setAssetPrefix(prefix: string): void {
  PREFIX = prefix.replace(/\/+$/, '');
}

export function assetPrefix(): string {
  return PREFIX;
}

/** The prefix as a regular expression source. */
export function assetPrefixSource(): string {
  return PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Asset URLs in HTML text (up to a quote, bracket or space). */
export function assetUrlPattern(): RegExp {
  return new RegExp(`${assetPrefixSource()}[^"')\\s<>]+`, 'g');
}

export function assetUrlFor(absPath: string): string {
  return PREFIX + absPath.split('/').map(encodeURIComponent).join('/');
}

export function pathFromAssetUrl(url: string): string | null {
  if (!url.startsWith(PREFIX)) return null;
  const rest = url.slice(PREFIX.length).split(/[?#]/, 1)[0];
  try {
    return rest.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}
