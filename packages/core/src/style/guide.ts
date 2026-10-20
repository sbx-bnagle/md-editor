// Style guide files: markdown with front matter choosing a base and overriding rules.
//
//   ---
//   base: ap
//   rules:
//     serial-comma: required
//   replace:
//     - use: toward
//       not: towards
//   avoid:
//     - phrase: utilize
//       suggest: use
//   reading-grade: 10
//   ---
//   Notes for the AI reviewer, in prose.

import { splitFrontMatter } from '../frontmatter';
import { BASES, RULES, type BaseId, type CustomRules, type StyleSettings } from './rules';

export interface StyleGuide {
  name: string;
  base: BaseId;
  settings: StyleSettings;
  custom: CustomRules;
  /** Target reading grade for readability highlighting. */
  readingGrade: number | null;
  /** Prose notes (body of the file) for AI review and generation. */
  notes: string;
  errors: string[];
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T];
}

export function parseStyleGuide(name: string, text: string): StyleGuide {
  const fm = splitFrontMatter(text);
  const d = fm.data;
  const errors: string[] = [];
  if (fm.error) errors.push(fm.error);
  const base = (typeof d.base === 'string' && d.base.toLowerCase() in BASES ? d.base.toLowerCase() : 'none') as BaseId;
  if (typeof d.base === 'string' && !(d.base.toLowerCase() in BASES)) errors.push(`Unknown base “${d.base}”. Use ap, chicago, oxford or none.`);
  const overrides: StyleSettings = {};
  const rules = (d.rules && typeof d.rules === 'object' ? d.rules : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rules)) {
    const info = RULES.find((r) => r.id === k);
    const value = v === false ? 'off' : String(v);
    if (!info) errors.push(`Unknown rule “${k}”.`);
    else if (!(value in info.options)) errors.push(`Rule “${k}”: use one of ${Object.keys(info.options).join(', ')}.`);
    else (overrides as Record<string, string>)[k] = value;
  }
  const custom: CustomRules = {
    replace: asArray<{ use: unknown; not: unknown; message?: unknown }>(d.replace)
      .filter((r) => r && typeof r.use === 'string' && r.not != null)
      .map((r) => ({ use: String(r.use), not: asArray<unknown>(r.not).map(String), message: r.message ? String(r.message) : undefined })),
    avoid: asArray<{ phrase?: unknown; suggest?: unknown; message?: unknown } | string>(d.avoid)
      .map((a) => (typeof a === 'string' ? { phrase: a } : a))
      .filter((a) => a && typeof a.phrase === 'string')
      .map((a) => ({ phrase: String(a.phrase), suggest: a.suggest != null ? String(a.suggest) : undefined, message: a.message ? String(a.message) : undefined })),
    patterns: asArray<{ match?: unknown; message?: unknown; suggest?: unknown; flags?: unknown }>(d.patterns)
      .filter((p) => p && typeof p.match === 'string')
      .map((p) => ({ match: String(p.match), message: String(p.message ?? 'Matches a pattern this guide flags.'), suggest: p.suggest != null ? String(p.suggest) : undefined, flags: p.flags ? String(p.flags) : undefined })),
  };
  for (const p of custom.patterns ?? []) {
    try {
      new RegExp(p.match, 'u');
    } catch {
      errors.push(`Pattern “${p.match}” is not a valid regular expression.`);
    }
  }
  const grade = Number(d['reading-grade']);
  return {
    name: typeof d.name === 'string' ? d.name : name,
    base,
    settings: { ...BASES[base].settings, ...overrides },
    custom,
    readingGrade: Number.isFinite(grade) && grade > 0 ? grade : null,
    notes: fm.body.trim(),
    errors,
  };
}

/** Plain-language summary of a guide's mechanical rules, for AI prompts. */
export function describeStyleGuide(g: StyleGuide): string {
  const lines: string[] = [];
  for (const r of RULES) {
    const v = (g.settings as Record<string, string | undefined>)[r.id];
    if (v && v !== 'off') lines.push(`- ${r.label}: ${r.options[v]}.`);
  }
  for (const r of g.custom.replace ?? []) lines.push(`- Use “${r.use}”, not ${asArray<string>(r.not).map((n) => `“${n}”`).join(' or ')}.`);
  for (const a of g.custom.avoid ?? []) lines.push(`- Avoid “${a.phrase}”${a.suggest ? `; use “${a.suggest}”` : ''}.`);
  if (g.readingGrade) lines.push(`- Aim for a US grade ${g.readingGrade} reading level.`);
  return lines.join('\n');
}
