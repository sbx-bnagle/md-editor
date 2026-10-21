// Checks that interface text colors meet WCAG 2 AAA contrast (7:1 for normal-size text,
// success criterion 1.4.6) on the surfaces where app.css and the editor theme use them.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const tokens = Object.fromEntries([...rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

type RGBA = [number, number, number, number];

function parse(value: string): RGBA {
  const v = value.trim();
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) {
    if (!(ref[1] in tokens)) throw new Error(`Unknown token --${ref[1]}`);
    return parse(tokens[ref[1]]);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((s) => s.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`Cannot parse color ${value}`);
}

/** Composites layers bottom-up: the first must be opaque. */
function surface(...layers: string[]): RGBA {
  let [r, g, b] = parse(layers[0]);
  for (const layer of layers.slice(1)) {
    const [lr, lg, lb, a] = parse(layer);
    r = lr * a + r * (1 - a);
    g = lg * a + g * (1 - a);
    b = lb * a + b * (1 - a);
  }
  return [r, g, b, 1];
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: RGBA): number {
  const a = luminance(surface(...[bg].map((c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`), fg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const S = (...layers: string[]) => surface(...layers);
const plain = ['--bg', '--bg-sidebar', '--bg-elev', '--bg-elev-2', '--bg-hover'].map((t) => `var(${t})`);

// [foreground, surfaces it appears on]
const pairs: Array<[string, RGBA[], string]> = [
  ['var(--text)', [...plain, 'var(--bg-active)'].map((b) => S(b)), 'body text, active segments and badges'],
  ['var(--text-dim)', plain.map((b) => S(b)), 'secondary text'],
  ['var(--text-faint)', plain.map((b) => S(b)), 'tertiary text, headings in menus, status bar'],
  ['var(--text-faint)', [S('var(--bg-elev)', 'rgba(255, 255, 255, 0.03)')], 'diff hunk header'],
  ['var(--accent-text)', [...plain.map((b) => S(b)), S('var(--bg-elev-2)', 'var(--accent-soft)'), S('var(--bg-sidebar)', 'rgba(122, 167, 255, 0.16)'), S('var(--bg-elev-2)', 'rgba(122, 167, 255, 0.16)'), S('var(--bg-elev)', 'rgba(122, 167, 255, 0.07)')], 'links, content block paths, badges'],
  ['#ffffff', [S('var(--accent-strong)'), S('var(--accent-strong-hover)'), S('var(--bg-sidebar)', 'var(--accent-soft)')], 'filled buttons, highlighted menu items, selected tree row'],
  ['var(--danger)', plain.map((b) => S(b)), 'errors'],
  ['var(--success)', [...plain.map((b) => S(b)), S('var(--bg-sidebar)', 'rgba(108, 192, 112, 0.14)'), S('var(--bg-elev-2)', 'rgba(108, 192, 112, 0.14)')], 'success text and badges'],
  ['var(--warning)', [...plain.map((b) => S(b)), S('var(--bg-sidebar)', 'rgba(224, 180, 83, 0.14)'), S('var(--bg-elev-2)', 'rgba(224, 180, 83, 0.14)')], 'warnings'],
  ['var(--text)', [S('var(--bg-elev)', 'rgba(108, 192, 112, 0.08)', 'rgba(108, 192, 112, 0.22)'), S('var(--bg-elev)', 'rgba(239, 107, 98, 0.08)', 'rgba(239, 107, 98, 0.22)')], 'changed words in diffs'],
  ['var(--text-dim)', [S('var(--bg-elev)', 'rgba(255, 255, 255, 0.025)')], 'front matter'],
  ['var(--editor-variable)', [S('var(--bg-elev)', 'rgba(232, 166, 216, 0.08)')], 'variables'],
];
const editorSurfaces = [
  S('var(--bg-elev)'),
  S('var(--bg-elev)', 'rgba(224, 180, 83, 0.08)'),
  S('var(--bg-elev)', 'rgba(239, 107, 98, 0.1)'),
  S('var(--bg-elev)', 'rgba(255, 200, 80, 0.06)'),
  S('var(--bg-elev)', 'rgba(110, 168, 254, 0.08)'),
];
for (const t of ['text', 'heading', 'strong', 'mark', 'link', 'code', 'quote', 'html', 'ai']) pairs.push([`var(--editor-${t})`, editorSurfaces, `editor ${t}`]);
for (const t of ['keyword', 'property', 'string', 'number', 'class', 'variable']) pairs.push([`var(--code-${t})`, [S('var(--bg-elev)')], `CSS ${t}`]);
// Selected text is a temporary state; the selection color keeps body text, not every syntax color, at 7:1.
for (const t of ['text', 'heading', 'strong']) pairs.push([`var(--editor-${t})`, [S('var(--bg-elev)', 'var(--selection)')], `selected editor ${t}`]);
pairs.push(['var(--text)', [S('var(--bg-elev)', 'var(--selection)'), S('var(--bg-elev-2)', 'var(--selection)')], 'selected interface text']);

describe('WCAG AAA contrast', () => {
  for (const [fg, surfaces, use] of pairs) {
    test(`${fg} (${use})`, () => {
      for (const bg of surfaces) expect(contrast(fg, bg), `${fg} on rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`).toBeGreaterThanOrEqual(7);
    });
  }

  test('editor search highlights use the alphas checked here', () => {
    const setup = readFileSync(new URL('../src/editor/setup.ts', import.meta.url), 'utf8');
    const alphas = [...setup.matchAll(/backgroundColor: 'rgba\(([^)]+)\)'/g)].map((m) => m[1].replace(/\s/g, ''));
    expect(alphas.sort()).toEqual(['110,168,254,0.08', '110,168,254,0.08', '255,200,80,0.06', '255,200,80,0.06'].sort());
  });
});
