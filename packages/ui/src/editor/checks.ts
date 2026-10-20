// Grammar (Harper, offline), style-guide rules, AI review results and readability
// highlights, shown as underlines with suggestions in a hover card.

import { linter, type Diagnostic } from '@codemirror/lint';
import { StateEffect, StateField } from '@codemirror/state';

/** Re-runs the checks (settings or guide changed). forceLinting only runs a pending check. */
const recheck = StateEffect.define<null>();
import type { EditorView } from '@codemirror/view';
import { checkStyle, maskNonProse, readability, type ReviewIssue, type StyleGuide } from '@mde/core';

export interface ChecksConfig {
  grammar: boolean;
  style: StyleGuide | null;
  styleOn: boolean;
  readability: boolean;
  readingGrade: number;
  onCounts?: (counts: { grammar: number; style: number; review: number }) => void;
}

let config: ChecksConfig = { grammar: true, style: null, styleOn: true, readability: false, readingGrade: 10 };

export function setChecksConfig(view: EditorView | null, next: Partial<ChecksConfig>): void {
  config = { ...config, ...next };
  if (view) view.dispatch({ effects: recheck.of(null) });
}

// ---------- Harper ----------

type HarperLinter = {
  lint(text: string, options?: { language?: 'markdown' | 'plaintext' }): Promise<Array<{
    span(): { start: number; end: number };
    message(): string;
    lint_kind_pretty(): string;
    suggestions(): Array<{ get_replacement_text(): string; kind(): number }>;
  }>>;
  getLintConfig(): Promise<Record<string, boolean | null>>;
  setLintConfig(c: Record<string, boolean | null>): Promise<void>;
};

let harper: Promise<HarperLinter | null> | null = null;

function loadHarper(): Promise<HarperLinter | null> {
  harper ??= (async () => {
    try {
      const [mod, { binary }] = await Promise.all([import('harper.js'), import('harper.js/binary')]);
      const linter = new mod.WorkerLinter({ binary }) as unknown as HarperLinter;
      // Spelling comes from the macOS dictionary, and heading case from the style guide,
      // so Harper's own rules for those are turned off.
      const cfg = await linter.getLintConfig();
      for (const k of Object.keys(cfg)) if (/spell|title.?case/i.test(k)) cfg[k] = false;
      await linter.setLintConfig(cfg);
      return linter;
    } catch (e) {
      console.error('Grammar checker unavailable', e);
      return null;
    }
  })();
  return harper;
}

/** Harper reports positions in Unicode scalar values; the editor uses UTF-16. */
function scalarToUtf16(text: string): (i: number) => number {
  if (!/[\uD800-\uDFFF]/.test(text)) return (i) => i;
  const map: number[] = [];
  let u = 0;
  for (const ch of text) {
    map.push(u);
    u += ch.length;
  }
  map.push(u);
  return (i) => map[Math.min(i, map.length - 1)];
}

const replaceAction = (label: string, insert: string) => ({
  name: label,
  apply: (view: EditorView, from: number, to: number) => view.dispatch({ changes: { from, to, insert }, userEvent: 'input.check' }),
});

async function grammarDiagnostics(text: string): Promise<Diagnostic[]> {
  if (!config.grammar) return [];
  const h = await loadHarper();
  if (!h) return [];
  const masked = maskNonProse(text);
  const lints = await h.lint(masked, { language: 'markdown' });
  const conv = scalarToUtf16(masked);
  const out: Diagnostic[] = [];
  for (const l of lints) {
    const span = l.span();
    const from = conv(span.start);
    const to = conv(span.end);
    // Skip lints that touch masked (non-prose) text, such as the spaces left by code spans.
    if (masked.slice(from, to) !== text.slice(from, to) || !masked.slice(from, to).trim()) continue;
    const actions = l
      .suggestions()
      .slice(0, 4)
      .map((s) => {
        const replacement = s.get_replacement_text();
        if (s.kind() === 1) return replaceAction('Remove', '');
        if (s.kind() === 2) return replaceAction(`Add “${replacement}”`, text.slice(from, to) + replacement);
        return replaceAction(replacement || 'Remove', replacement);
      });
    out.push({ from, to, severity: 'warning', markClass: 'cm-grammar', source: `Grammar · ${l.lint_kind_pretty()}`, message: l.message(), actions });
  }
  return out;
}

function styleDiagnostics(text: string): Diagnostic[] {
  const g = config.style;
  if (!g || !config.styleOn) return [];
  return checkStyle(text, g.settings, g.custom).map((i) => ({
    from: i.from,
    to: Math.max(i.to, i.from + 1),
    severity: 'info',
    markClass: 'cm-style',
    source: `Style · ${g.name}`,
    message: i.message,
    actions: i.suggestions.slice(0, 3).map((s) => replaceAction(s === '' ? 'Remove' : s.trim() === '' ? 'Fix spacing' : s, s)),
  }));
}

function readabilityDiagnostics(text: string): Diagnostic[] {
  if (!config.readability) return [];
  const target = config.style?.readingGrade ?? config.readingGrade;
  return readability(text)
    .sentenceGrades.filter((s) => s.words >= 8 && s.grade > target)
    .map((s) => ({
      from: s.from,
      to: s.to,
      severity: 'hint',
      markClass: s.grade > target + 4 ? 'cm-very-hard' : 'cm-hard',
      source: 'Readability',
      message: `This sentence reads at about grade ${Math.round(s.grade)} (target ${target}). Splitting it or using shorter words would make it easier to read.`,
    }));
}

// ---------- AI review results, kept aligned with edits ----------

export const setReviewIssues = StateEffect.define<Array<ReviewIssue & { from: number; to: number }>>();

export const reviewField = StateField.define<Array<ReviewIssue & { from: number; to: number }>>({
  create: () => [],
  update(issues, tr) {
    for (const e of tr.effects) if (e.is(setReviewIssues)) return e.value;
    if (!tr.docChanged) return issues;
    return issues
      .map((i) => ({ ...i, from: tr.changes.mapPos(i.from, 1), to: tr.changes.mapPos(i.to, -1) }))
      .filter((i) => i.to > i.from);
  },
});

function reviewDiagnostics(view: EditorView): Diagnostic[] {
  return view.state.field(reviewField, false)?.map((i) => ({
    from: i.from,
    to: i.to,
    severity: 'info' as const,
    markClass: 'cm-review',
    source: 'AI review',
    message: i.message,
    actions: i.suggestion ? [replaceAction(i.suggestion.length > 40 ? 'Apply suggestion' : i.suggestion, i.suggestion)] : [],
  })) ?? [];
}

export function checks() {
  return [
    reviewField,
    linter(
      async (view) => {
        const text = view.state.doc.toString();
        const [grammar, style, review, hard] = await Promise.all([
          grammarDiagnostics(text).catch(() => []),
          Promise.resolve(styleDiagnostics(text)),
          Promise.resolve(reviewDiagnostics(view)),
          Promise.resolve(readabilityDiagnostics(text)),
        ]);
        // Results computed for an older document are dropped by the lint extension.
        config.onCounts?.({ grammar: grammar.length, style: style.length, review: review.length });
        return [...hard, ...grammar, ...style, ...review];
      },
      {
        delay: 600,
        autoPanel: false,
        needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(recheck) || e.is(setReviewIssues))),
      },
    ),
  ];
}
