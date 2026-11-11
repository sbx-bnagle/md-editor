// The theme's CSS rules, as the CSS editor parses them (Lezer), with where each one's declarations sit
// in the file, and which of them apply to an element of the preview: style rules (also through a
// pseudo-element such as ::before), @page rules for the element's page and margin-box rules
// (@top-center…) for a running header or footer. Used by the rule flyout of the theme preview.

import { cssLanguage } from '@codemirror/lang-css';
import type { SyntaxNode } from '@lezer/common';

export interface CssRule {
  /** Order among the rules found (identifies a rule while only its declarations change). */
  index: number;
  kind: 'style' | 'page' | 'margin';
  /** Selector as written, or "@page :first", or "@top-center". */
  selector: string;
  /** Enclosing at-rules and rules, outermost first ("@media print", "@page :first"). */
  context: string[];
  /** The text between the rule's braces. */
  bodyFrom: number;
  bodyTo: number;
  /** 1-based line where the rule starts. */
  line: number;
  /** For nested style rules (CSS nesting), the selector with `&` resolved against the parent. */
  resolved?: string;
}

const AT_RULES_WITH_RULES = new Set(['MediaStatement', 'SupportsStatement']);
const headerOf = (text: string, node: SyntaxNode, block: SyntaxNode) => text.slice(node.from, block.from).trim().replace(/\s+/g, ' ');

/** Splits a selector list at its top-level commas. */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

/** Every rule of the stylesheet whose declarations can be shown and edited. */
export function cssRules(text: string): CssRule[] {
  const tree = cssLanguage.parser.parse(text);
  const rules: CssRule[] = [];
  const lineAt = (pos: number) => text.slice(0, pos).split('\n').length;
  const visit = (node: SyntaxNode, context: string[], parentSelector: string | null, page: string | null) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      const block = child.getChild('Block');
      // A block cut off by a typing error is not offered for editing.
      if (!block || text[block.to - 1] !== '}') {
        if (block) continue;
        if (child.name === 'Block') visit(child, context, parentSelector, page);
        continue;
      }
      if (child.name === 'RuleSet') {
        const selector = headerOf(text, child, block);
        const resolved = parentSelector
          ? splitSelectors(selector)
              .map((s) => (s.includes('&') ? s.replaceAll('&', `:is(${parentSelector})`) : `:is(${parentSelector}) ${s}`))
              .join(', ')
          : undefined;
        rules.push({ index: rules.length, kind: 'style', selector, context, bodyFrom: block.from + 1, bodyTo: block.to - 1, line: lineAt(child.from), ...(resolved ? { resolved } : {}) });
        visit(block, [...context, selector], resolved ?? selector, page);
      } else if (AT_RULES_WITH_RULES.has(child.name)) {
        visit(block, [...context, headerOf(text, child, block)], parentSelector, page);
      } else if (child.name === 'AtRule') {
        const header = headerOf(text, child, block);
        const keyword = header.split(/[\s{(]/)[0].toLowerCase();
        if (keyword === '@page') {
          rules.push({ index: rules.length, kind: 'page', selector: header, context, bodyFrom: block.from + 1, bodyTo: block.to - 1, line: lineAt(child.from) });
          visit(block, [...context, header], null, header);
        } else if (page && /^@(top|bottom|left|right)-/.test(keyword)) {
          rules.push({ index: rules.length, kind: 'margin', selector: keyword, context, bodyFrom: block.from + 1, bodyTo: block.to - 1, line: lineAt(child.from) });
        } else if (keyword === '@layer' || keyword === '@container' || keyword === '@scope') {
          visit(block, [...context, header], parentSelector, page);
        }
      }
    }
  };
  visit(tree.topNode, [], null, null);
  return rules;
}

const PSEUDO_ELEMENT = /::?(before|after|marker|first-line|first-letter|placeholder|selection|footnote-call|footnote-marker)\b.*$/i;

/** Whether the element matches a selector; with a pseudo-element, whether its element does (and which pseudo-element). */
function matchSelector(el: Element, selector: string): { pseudo?: string } | null {
  const pseudo = PSEUDO_ELEMENT.exec(selector);
  const base = pseudo ? selector.slice(0, pseudo.index).trim() || '*' : selector;
  try {
    if (!el.matches(base)) return null;
  } catch {
    return null;
  }
  return pseudo ? { pseudo: `::${pseudo[1].toLowerCase()}` } : {};
}

/** Whether the page's classes (Paged.js) fit an @page selector ("@page", "@page :first", "@page cover:left"). */
function pageMatches(page: Element, header: string): boolean {
  const list = header.replace(/^@page/i, '').trim();
  if (!list) return true;
  return splitSelectors(list).some((sel) => {
    const [, name, pseudos] = /^([\w-]*)((?::[\w-]+)*)$/.exec(sel.replace(/\s+/g, '')) ?? [];
    if (name === undefined) return false;
    if (name && !page.classList.contains(`pagedjs_${name}_page`)) return false;
    return (pseudos.match(/:[\w-]+/g) ?? []).every((p) => page.classList.contains(`pagedjs_${p.slice(1)}_page`));
  });
}

export interface RuleMatch {
  rule: CssRule;
  /** The pseudo-element the rule styles (::before…), when it is not the element itself. */
  pseudo?: string;
}

export interface Inspection {
  /** What was chosen, for the flyout's title ("p.lead", "@top-center margin box", "page 3"). */
  label: string;
  /** A selector for a new rule aimed at the element (none for pages and margin boxes). */
  suggestion: string | null;
  own: RuleMatch[];
  /** Rules of the element's ancestors, nearest first, labelled with the ancestor. */
  inherited: Array<{ from: string; matches: RuleMatch[] }>;
}

const describe = (el: Element) =>
  `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList]
    .filter((c) => !c.startsWith('pagedjs') && !c.startsWith('mde-'))
    .map((c) => `.${c}`)
    .join('')}`;

/** The rules of the theme that apply to an element of the laid-out preview. */
export function inspectElement(el: Element, rules: CssRule[]): Inspection {
  const page = el.closest('.pagedjs_page');
  const margin = el.closest('.pagedjs_margin');
  const pageRules = (): RuleMatch[] => (page ? rules.filter((r) => r.kind === 'page' && pageMatches(page, r.selector)).map((rule) => ({ rule })) : []);
  if (margin) {
    const box = [...margin.classList].find((c) => c.startsWith('pagedjs_margin-'))?.slice('pagedjs_margin-'.length) ?? '';
    const own = rules.filter((r) => r.kind === 'margin' && r.selector === `@${box}` && (!page || pageMatches(page, r.context[r.context.length - 1] ?? '@page'))).map((rule) => ({ rule }));
    return { label: `@${box} margin box`, suggestion: null, own, inherited: [{ from: 'the page', matches: pageRules() }].filter((g) => g.matches.length) };
  }
  // The page around the text, not something in it.
  if (page && !el.closest('.pagedjs_page_content')) {
    const number = page.getAttribute('data-page-number');
    return { label: number ? `page ${number}` : 'page', suggestion: null, own: pageRules(), inherited: [] };
  }
  const styleMatches = (target: Element, pseudos: boolean): RuleMatch[] => {
    const out: RuleMatch[] = [];
    for (const rule of rules) {
      if (rule.kind !== 'style') continue;
      for (const sel of splitSelectors(rule.resolved ?? rule.selector)) {
        const m = matchSelector(target, sel);
        if (m && (pseudos || !m.pseudo)) {
          out.push({ rule, ...m });
          break;
        }
      }
    }
    return out;
  };
  const own = styleMatches(el, true);
  const seen = new Set(own.map((m) => m.rule.index));
  const inherited: Inspection['inherited'] = [];
  for (let a = el.parentElement; a; a = a.parentElement) {
    // Paged.js's own wrappers carry no theme rules worth listing; the document's elements and body/html do.
    if (/^pagedjs_/.test(a.className) || a.id === 'pages') continue;
    const matches = styleMatches(a, false).filter((m) => !seen.has(m.rule.index));
    for (const m of matches) seen.add(m.rule.index);
    if (matches.length) inherited.push({ from: describe(a), matches });
  }
  const classes = [...el.classList].filter((c) => !c.startsWith('pagedjs') && !c.startsWith('mde-'));
  return { label: describe(el), suggestion: `${el.tagName.toLowerCase()}${classes.length ? `.${classes[0]}` : ''}`, own, inherited };
}

/** The declarations of a rule as shown for editing: without the common indent and outer blank lines. */
export function bodyForEditing(text: string, rule: CssRule): string {
  const lines = text.slice(rule.bodyFrom, rule.bodyTo).split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return '';
  const lead = (l: string) => /^[ \t]*/.exec(l)![0].length;
  const indent = Math.min(...lines.filter((l) => l.trim()).map(lead));
  return lines.map((l) => l.slice(Math.min(indent, lead(l))).trimEnd()).join('\n');
}

/** Braces outside strings and comments are balanced (so an edit cannot end the rule early). */
export function balanced(body: string): boolean {
  let depth = 0;
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  for (const c of clean) {
    if (c === '{') depth++;
    else if (c === '}' && --depth < 0) return false;
  }
  return depth === 0 && !/\/\*/.test(clean);
}

/** The new text between a rule's braces for edited declarations, in the rule's own layout (one line or indented lines). */
export function bodyFromEditing(text: string, rule: CssRule, edited: string): string {
  const old = text.slice(rule.bodyFrom, rule.bodyTo);
  const lines = edited.replace(/\s+$/, '').split('\n');
  if (!old.includes('\n') && lines.length === 1) return lines[0].trim() ? ` ${lines[0].trim()} ` : ' ';
  const lineStart = text.lastIndexOf('\n', rule.bodyFrom - 1) + 1;
  const ruleIndent = /^[ \t]*/.exec(text.slice(lineStart))![0];
  const firstLine = old.split('\n').find((l, i) => i > 0 && l.trim());
  const indent = firstLine ? /^[ \t]*/.exec(firstLine)![0] : `${ruleIndent}  `;
  if (!edited.trim()) return `\n${ruleIndent}`;
  return `\n${lines.map((l) => (l.trim() ? indent + l : '')).join('\n')}\n${ruleIndent}`;
}
