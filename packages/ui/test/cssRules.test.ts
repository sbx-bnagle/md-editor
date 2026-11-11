import { describe, expect, test } from 'vitest';
import { balanced, bodyForEditing, bodyFromEditing, cssRules, splitSelectors } from '../src/preview/cssRules';

const CSS = `@import url(x.css);
:root { --accent: #036; }
body, p.lead::first-line {
  font: 11pt/1.4 serif;
  color: #222;
}
@media print {
  h1 { color: red; }
}
@page {
  size: letter;
  @top-center { content: string(title); }
}
@page :first { @top-center { content: none } }
@font-face { font-family: X; src: url(a.woff2); }
@keyframes k { from { opacity: 0 } }
.card { padding: 1em; & h2 { margin: 0 } }
`;

describe('theme CSS rules for the preview’s rule flyout', () => {
  test('style, @page and margin-box rules, with their context, line and declarations', () => {
    const rules = cssRules(CSS);
    expect(rules.map((r) => [r.kind, r.selector, r.context.join(' / '), r.line])).toEqual([
      ['style', ':root', '', 2],
      ['style', 'body, p.lead::first-line', '', 3],
      ['style', 'h1', '@media print', 8],
      ['page', '@page', '', 10],
      ['margin', '@top-center', '@page', 12],
      ['page', '@page :first', '', 14],
      ['margin', '@top-center', '@page :first', 14],
      ['style', '.card', '', 17],
      ['style', '& h2', '.card', 17],
    ]);
    expect(rules[8].resolved).toBe(':is(.card) h2');
    expect(bodyForEditing(CSS, rules[1])).toBe('font: 11pt/1.4 serif;\ncolor: #222;');
    expect(bodyForEditing(CSS, rules[2])).toBe('color: red;');
  });

  test('edited declarations keep the rule’s layout', () => {
    const rules = cssRules(CSS);
    const apply = (i: number, edited: string) => {
      const r = rules[i];
      return CSS.slice(0, r.bodyFrom) + bodyFromEditing(CSS, r, edited) + CSS.slice(r.bodyTo);
    };
    expect(apply(1, 'font: 12pt serif;\ncolor: #000;')).toContain('body, p.lead::first-line {\n  font: 12pt serif;\n  color: #000;\n}\n');
    expect(apply(2, 'color: blue;')).toContain('  h1 { color: blue; }\n');
    expect(apply(2, 'color: blue;\nmargin: 0;')).toContain('  h1 {\n    color: blue;\n    margin: 0;\n  }\n');
    // The result parses to the same rules.
    expect(cssRules(apply(1, 'font: 12pt serif;')).map((r) => r.selector)).toEqual(rules.map((r) => r.selector));
  });

  test('selector lists split at top-level commas; unbalanced braces are refused', () => {
    expect(splitSelectors('a, :is(b, c), [data-x="1,2"]')).toEqual(['a', ':is(b, c)', '[data-x="1,2"]']);
    expect(balanced('color: red; content: "}";')).toBe(true);
    expect(balanced('color: red; }')).toBe(false);
    expect(balanced('a { color: red')).toBe(false);
    expect(balanced('color: red; /* open')).toBe(false);
  });
});
