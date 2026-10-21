import { describe, expect, test } from 'vitest';
import { cssImageRefs, rewriteCssImageRefs, templateImageRefs, themeImageReport } from '../src/themeImages';

const css = `
/* url("images/commented.png") */
@font-face { font-family: "Brand"; src: url("fonts/brand.woff2"); }
@import url("print.css");
@page { @top-left { content: url("images/logo.svg"); } }
.hero { background: url(images/hero.jpg?v=2) no-repeat, url('./images/hero.jpg'); }
.mark { background-image: url("../../Collections/Brand/mark.PNG"); }
.web { background: url("https://example.com/a.png"), url(data:image/png;base64,AAAA), url("/abs/b.png"); }
`;

describe('theme images', () => {
  test('image references in CSS and templates', () => {
    expect(cssImageRefs(css)).toEqual(['images/logo.svg', 'images/hero.jpg', './images/hero.jpg', '../../Collections/Brand/mark.PNG']);
    expect(templateImageRefs(`<img src="{{ "images/badge.webp" | theme_url }}" alt="{{ include.alt }}"> {{ 'fonts/x.woff2' | theme_url }} {{ include.src | theme_url }}`)).toEqual(['images/badge.webp']);
  });

  test('report: packaged, missing and outside the theme folder', () => {
    const files = ['theme.css', 'images/logo.svg', 'images/Hero.jpg', 'fonts/brand.woff2', 'includes/badge.html'];
    expect(themeImageReport([...cssImageRefs(css), 'images/badge.webp'], files)).toEqual({
      packaged: ['images/Hero.jpg', 'images/logo.svg'],
      missing: ['images/badge.webp'],
      outside: ['../../Collections/Brand/mark.PNG'],
    });
  });

  test('rewriting leaves font sources and unmapped references alone', () => {
    const out = rewriteCssImageRefs(css, (ref) => (ref.startsWith('../') ? 'images/mark.PNG' : null));
    expect(out).toContain('url("images/mark.PNG")');
    expect(out).toContain('src: url("fonts/brand.woff2")');
    expect(out).toContain("url('./images/hero.jpg')");
    expect(rewriteCssImageRefs('@font-face { src: url("../x.png"); }', () => 'images/x.png')).toBe('@font-face { src: url("../x.png"); }');
  });
});
