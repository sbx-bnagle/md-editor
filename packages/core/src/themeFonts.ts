// Fonts in themes: which families a theme's CSS uses, which it packages with @font-face, and the
// names inside font files (so added fonts get the right @font-face rules).

import { unzlibSync } from 'fflate';

/** CSS generic and system family keywords; they are never packaged. */
const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
  'revert',
]);

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, '$2').trim();

function families(list: string): string[] {
  return list
    .replace(/!\s*important\s*$/i, '')
    .split(',')
    .map(unquote)
    .filter((f) => f && !f.startsWith('var(') && !GENERIC.has(f.toLowerCase()));
}

/** Families named in font-family and font declarations (outside @font-face). */
export function fontFamiliesUsed(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[;{\s])font-family\s*:\s*([^;}]+)/g)) for (const f of families(m[1])) out.add(f);
  // The family list comes last in the font shorthand, after the size (and line height).
  for (const m of text.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]+)/g)) {
    const after = /(?:^|\s)[\d.]+(?:pt|px|em|rem|%|in|cm|mm|ex|ch|vw|vh)(?:\s*\/\s*[\w.%]+)?\s+(.+)$/.exec(m[1].trim());
    if (after) for (const f of families(after[1])) out.add(f);
  }
  return [...out];
}

export interface FontFace {
  family: string;
  /** url() sources, as written. */
  urls: string[];
}

export function fontFaces(css: string): FontFace[] {
  const out: FontFace[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = /font-family\s*:\s*([^;]+)/.exec(m[1]);
    if (!family) continue;
    const urls = [...m[1].matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)].map((u) => u[2]);
    out.push({ family: unquote(family[1]), urls });
  }
  return out;
}

export interface ThemeFontReport {
  /** Families with @font-face rules whose files are in the theme. */
  packaged: string[];
  /** Families used by name only: they show only where the font is installed. */
  byName: string[];
  /** Font files named in @font-face rules but missing from the theme. */
  missingFiles: string[];
}

/** `files` are the theme's files, relative to the theme folder, with forward slashes. */
export function themeFontReport(css: string, files: string[]): ThemeFontReport {
  const have = new Set(files.map((f) => f.toLowerCase()));
  const faces = fontFaces(css);
  const packaged = new Set<string>();
  const missingFiles: string[] = [];
  for (const f of faces) {
    for (const u of f.urls) {
      if (/^(?:[a-z]+:|\/)/i.test(u)) continue;
      const rel = u.replace(/^\.\//, '').split(/[?#]/)[0];
      if (have.has(rel.toLowerCase())) packaged.add(f.family);
      else missingFiles.push(rel);
    }
  }
  const defined = new Set(faces.map((f) => f.family.toLowerCase()));
  const byName = fontFamiliesUsed(css).filter((f) => !defined.has(f.toLowerCase()));
  return { packaged: [...packaged], byName, missingFiles };
}

export interface FontFileInfo {
  family: string;
  weight: number;
  italic: boolean;
}

/** Tables of a TrueType/OpenType file, or of a WOFF file (decompressed). */
function sfntTables(bytes: Uint8Array): Map<string, Uint8Array> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  const out = new Map<string, Uint8Array>();
  const sig = tag(0);
  if (sig === 'wOFF') {
    const n = view.getUint16(12);
    for (let i = 0; i < n; i++) {
      const e = 44 + i * 20;
      const offset = view.getUint32(e + 4);
      const compLength = view.getUint32(e + 8);
      const origLength = view.getUint32(e + 12);
      const data = bytes.subarray(offset, offset + compLength);
      out.set(tag(e), compLength < origLength ? unzlibSync(data) : data);
    }
    return out;
  }
  if (sig === '\x00\x01\x00\x00' || sig === 'OTTO' || sig === 'true') {
    const n = view.getUint16(4);
    for (let i = 0; i < n; i++) {
      const e = 12 + i * 16;
      out.set(tag(e), bytes.subarray(view.getUint32(e + 8), view.getUint32(e + 8) + view.getUint32(e + 12)));
    }
    return out;
  }
  return null;
}

/**
 * Family, weight and style from a TTF, OTF or WOFF file. Null for other files (WOFF2 needs
 * Brotli, which is not available here); callers then fall back to the file name.
 */
export function readFontInfo(bytes: Uint8Array): FontFileInfo | null {
  try {
    const tables = sfntTables(bytes);
    const name = tables?.get('name');
    if (!tables || !name) return null;
    const v = new DataView(name.buffer, name.byteOffset, name.byteLength);
    const count = v.getUint16(2);
    const strings = v.getUint16(4);
    const found: Record<number, string> = {};
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      const platform = v.getUint16(r);
      const id = v.getUint16(r + 6);
      const len = v.getUint16(r + 8);
      const off = strings + v.getUint16(r + 10);
      if (id !== 1 && id !== 16) continue;
      let s = '';
      if (platform === 3 || platform === 0) for (let k = 0; k < len; k += 2) s += String.fromCharCode(v.getUint16(off + k));
      else if (platform === 1) for (let k = 0; k < len; k++) s += String.fromCharCode(v.getUint8(off + k));
      else continue;
      // Prefer Windows/Unicode names over Mac Roman ones.
      if (s && (!(id in found) || platform !== 1)) found[id] = s;
    }
    // Without a typographic family (16), the legacy family (1) can carry the weight: "Plex Sans SemiBold".
    const family = found[16] ?? found[1]?.replace(/\s+(Thin|Hairline|ExtraLight|UltraLight|Light|Book|Medium|SemiBold|DemiBold|ExtraBold|UltraBold|Black|Heavy)$/i, '');
    if (!family) return null;
    const os2 = tables.get('OS/2');
    const o = os2 ? new DataView(os2.buffer, os2.byteOffset, os2.byteLength) : null;
    return { family, weight: o ? o.getUint16(4) : 400, italic: o ? (o.getUint16(62) & 1) === 1 : false };
  } catch {
    return null;
  }
}

/** A family name from a file name: "SourceSerif4-SemiboldItalic.woff2" → "SourceSerif4". */
export function familyFromFileName(file: string): FontFileInfo {
  const base = file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  const [family, style = ''] = base.split('-');
  const s = style.toLowerCase();
  const weights: Array<[RegExp, number]> = [
    [/thin|hairline/, 100],
    [/extralight|ultralight/, 200],
    [/light/, 300],
    [/medium/, 500],
    [/semibold|demibold/, 600],
    [/extrabold|ultrabold/, 800],
    [/black|heavy/, 900],
    [/bold/, 700],
  ];
  return { family: family || base, weight: weights.find(([re]) => re.test(s))?.[1] ?? 400, italic: /italic|oblique/.test(s) };
}

const FORMATS: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/** An @font-face rule for a font file in the theme folder. */
export function fontFaceRule(rel: string, info: FontFileInfo): string {
  const ext = rel.split('.').pop()!.toLowerCase();
  return `@font-face {\n  font-family: "${info.family.replace(/"/g, '')}";\n  src: url("${rel}") format("${FORMATS[ext] ?? ext}");\n  font-weight: ${info.weight};\n  font-style: ${info.italic ? 'italic' : 'normal'};\n}\n`;
}
