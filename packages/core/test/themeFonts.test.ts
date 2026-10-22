import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { familyFromFileName, fontFaceRule, fontFamiliesUsed, readFontInfo, themeFontReport } from '../src/themeFonts';

const css = `
/* font: 9pt "Commented Out"; */
@font-face { font-family: "Plex Sans"; src: url("fonts/plex.woff2") format("woff2"); }
@font-face { font-family: 'Gone'; src: url(fonts/gone.woff); }
html { font-family: "Iowan Old Style", Charter, Georgia, serif; }
@page { @top-left { font: 600 7.5pt/1 "Avenir Next", "Helvetica Neue", sans-serif; } }
h1 { font-family: "Plex Sans", var(--x), system-ui; }
`;

describe('theme fonts', () => {
  test('families used, packaged and by name', () => {
    expect(fontFamiliesUsed(css)).toEqual(['Iowan Old Style', 'Charter', 'Georgia', 'Plex Sans', 'Avenir Next', 'Helvetica Neue']);
    expect(fontFamiliesUsed(".icon::before { font-family: 'icomoon' !important; }")).toEqual(['icomoon']);
    expect(themeFontReport(css, ['theme.css', 'fonts/plex.woff2'])).toEqual({
      packaged: ['Plex Sans'],
      byName: ['Iowan Old Style', 'Charter', 'Georgia', 'Avenir Next', 'Helvetica Neue'],
      missingFiles: ['fonts/gone.woff'],
    });
  });

  test('names inside font files', () => {
    const woff = 'node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-italic.woff';
    expect(readFontInfo(new Uint8Array(readFileSync(woff)))).toEqual({ family: 'IBM Plex Sans', weight: 600, italic: true });
    const ttf = '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf';
    if (existsSync(ttf)) expect(readFontInfo(new Uint8Array(readFileSync(ttf)))).toEqual({ family: 'Liberation Serif', weight: 700, italic: false });
    expect(readFontInfo(new TextEncoder().encode('not a font file at all'))).toBeNull();
    expect(familyFromFileName('fonts/SourceSerif4-SemiboldItalic.woff2')).toEqual({ family: 'SourceSerif4', weight: 600, italic: true });
    expect(fontFaceRule('fonts/a.woff2', { family: 'A', weight: 700, italic: false })).toBe('@font-face {\n  font-family: "A";\n  src: url("fonts/a.woff2") format("woff2");\n  font-weight: 700;\n  font-style: normal;\n}\n');
  });
});
