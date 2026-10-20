// URLs for local files referenced by documents and themes (images, fonts).
// The host serves this scheme and must only serve files inside allowed roots.

export const ASSET_SCHEME = 'mde-asset';
const PREFIX = `${ASSET_SCHEME}://local`;

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
