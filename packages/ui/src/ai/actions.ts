import {
  HEADLINE_SCHEMA,
  REVIEW_SCHEMA,
  aiAuthorKey,
  computeDiff,
  headlineMessages,
  locateQuotes,
  parseHeadlines,
  parseReview,
  paths,
  refineVoiceMessages,
  reviewMessages,
  writingSystemPrompt,
  type AiInsertion,
} from '@mde/core';
import { api } from '../api/host';
import { aiAuthor } from '../editor/authorship';
import { editorBridge } from '../editor/bridge';
import { setReviewIssues } from '../editor/checks';
import { openDialog } from '../state/actions';
import { getState, setState, toast } from '../state/store';
import { refreshActiveGuides, writingContext } from './context';

export function providerReady(): boolean {
  const { prefs, keyStatus } = getState();
  if (!prefs) return false;
  const p = prefs.ai.providers.find((x) => x.id === prefs.ai.defaultProvider);
  if (!p) return false;
  // Local OpenAI-compatible servers usually need no key.
  return p.kind === 'openai-compatible' ? !!p.baseUrl && !!p.model : !!keyStatus[p.id];
}

function requireProvider(): boolean {
  if (providerReady()) return true;
  toast('Set up an AI service first.', 'info', { label: 'Open Settings', run: () => setState({ settingsOpen: true }) });
  return false;
}

export function openCommandBar(): void {
  const { doc, mode } = getState();
  const view = editorBridge.view;
  if (!doc || doc.kind !== 'markdown' || mode !== 'edit' || !view) {
    toast('Open a markdown document in the editor to use the AI.');
    return;
  }
  if (!requireProvider()) return;
  const sel = view.state.selection.main;
  setState({ commandBar: { mode: sel.empty ? 'generate' : 'rewrite', from: sel.from, to: sel.to } });
  refreshActiveGuides().catch(() => undefined);
}

/** Inserts AI-written text, recording its authorship and logging it for voice refinement. */
export function insertAiText(opts: { from: number; to: number; text: string; model: string; mode: AiInsertion['mode']; prompt: string }): void {
  const view = editorBridge.view;
  const { doc, prefs } = getState();
  if (!view || !doc) return;
  view.dispatch({
    changes: { from: opts.from, to: opts.to, insert: opts.text },
    selection: { anchor: opts.from + opts.text.length },
    userEvent: 'input.ai',
    annotations: prefs?.recordAuthorship ? aiAuthor.of(aiAuthorKey(opts.model)) : [],
    scrollIntoView: true,
  });
  view.focus();
  if (doc.projectPath) {
    api.ai.logInsertion({ docPath: doc.path, time: Date.now(), model: opts.model, mode: opts.mode, prompt: opts.prompt, text: opts.text }).catch(() => undefined);
  }
}

export async function runReview(): Promise<void> {
  const { doc } = getState();
  const view = editorBridge.view;
  if (!doc || doc.kind !== 'markdown' || !view) {
    toast('Open a markdown document to review it.');
    return;
  }
  if (!requireProvider()) return;
  setState({ panel: 'insights', review: { docPath: doc.path, running: true, issues: [], unplaced: 0 } });
  try {
    await refreshActiveGuides();
    const text = view.state.doc.toString();
    const result = await api.ai.complete({
      purpose: 'review',
      system: writingSystemPrompt(writingContext()),
      messages: reviewMessages(writingContext(), text),
      jsonSchema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 16000,
    });
    if (result.refused) throw new Error('The model declined to review this document.');
    const parsed = parseReview(result.text);
    // The document may have changed while the review ran; locate quotes in the current text.
    const current = editorBridge.view?.state.doc.toString() ?? text;
    const placed = locateQuotes(current, parsed);
    setState({ review: { docPath: doc.path, running: false, issues: placed, unplaced: parsed.length - placed.length } });
    const v = editorBridge.view;
    if (v && getState().doc?.path === doc.path) v.dispatch({ effects: setReviewIssues.of(placed) });
  } catch (e) {
    setState({ review: { docPath: doc.path, running: false, issues: [], unplaced: 0, error: e instanceof Error ? e.message : String(e) } });
  }
}

export function clearReview(): void {
  setState({ review: null });
  const v = editorBridge.view;
  if (v) v.dispatch({ effects: setReviewIssues.of([]) });
}

export async function suggestHeadlines(headline: string, context: string): Promise<Array<{ text: string; why: string }>> {
  if (!requireProvider()) return [];
  await refreshActiveGuides();
  const result = await api.ai.complete({
    purpose: 'headline',
    system: writingSystemPrompt(writingContext()),
    messages: headlineMessages(headline, context),
    jsonSchema: HEADLINE_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 4000,
  });
  if (result.refused) throw new Error('The model declined this request.');
  return parseHeadlines(result.text);
}

/** Best-matching paragraph(s) in `doc` for a piece of AI text, by shared words. */
function findFinalVersion(doc: string, aiText: string): string | null {
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\d’']+/gu) ?? []);
  const target = words(aiText);
  if (target.size === 0) return null;
  let best: { score: number; text: string } | null = null;
  const paragraphs = doc.split(/\n\s*\n/);
  const span = Math.max(1, aiText.split(/\n\s*\n/).length);
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs.slice(i, i + span).join('\n\n');
    const w = words(text);
    let shared = 0;
    for (const x of w) if (target.has(x)) shared++;
    const score = shared / Math.max(target.size, w.size);
    if (!best || score > best.score) best = { score, text };
  }
  return best && best.score >= 0.3 ? best.text : null;
}

/** Proposes additions to the open voice guide from how AI drafts were edited in a project. */
export async function refineVoice(): Promise<void> {
  const { doc, tree } = getState();
  const view = editorBridge.view;
  if (!doc || !view || !doc.path.includes('/Guides/Voices/')) {
    toast('Open a voice guide to refine it.');
    return;
  }
  if (!requireProvider()) return;
  const projects = tree?.collections.flatMap((c) => c.projects.map((p) => ({ value: p.path, label: `${c.name} › ${p.name}` }))) ?? [];
  if (!projects.length) {
    toast('There are no projects with AI drafts yet.');
    return;
  }
  openDialog({
    title: 'Refine voice from edits',
    message: 'Compares AI drafts accepted in a project with how they read now, and proposes changes to this guide. You review the changes before anything is saved.',
    fields: [{ name: 'project', label: 'Project', type: 'select', value: projects[0].value, options: projects }],
    okLabel: 'Analyze',
    onSubmit: async (v) => {
      try {
        const project = String(v.project);
        const entries = await api.ai.insertions(project, 20);
        if (!entries.length) return 'No AI text has been accepted in this project yet.';
        const docs = new Map<string, string | null>();
        const examples: Array<{ ai: string; final: string }> = [];
        for (const e of entries) {
          if (!docs.has(e.docPath)) docs.set(e.docPath, await api.files.readDocument(e.docPath).then((d) => d.text).catch(() => null));
          const text = docs.get(e.docPath);
          const final = text ? findFinalVersion(text, e.text) : null;
          if (final && final.trim() !== e.text.trim()) examples.push({ ai: e.text, final });
        }
        if (!examples.length) return 'The accepted AI drafts have not been edited, so there is nothing to learn from yet.';
        const current = view.state.doc.toString();
        toast(`Analyzing ${examples.length} edited draft${examples.length === 1 ? '' : 's'}…`);
        const result = await api.ai.complete({
          purpose: 'voice',
          system: 'You maintain a writer’s voice guide for an AI writing assistant.',
          messages: refineVoiceMessages({ name: paths.basename(doc.path, '.md'), text: current }, examples),
          maxTokens: 16000,
        });
        if (result.refused) return 'The model declined this request.';
        const proposed = result.text.replace(/^```(?:markdown)?\n([\s\S]*)\n```\s*$/, '$1').trim() + '\n';
        showVoiceProposal(current, proposed);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  });
}

function showVoiceProposal(current: string, proposed: string): void {
  const hunks = computeDiff(current, proposed, 1);
  const added = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'add').length, 0);
  const removed = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'del').length, 0);
  if (!added && !removed) {
    toast('No changes proposed.');
    return;
  }
  setState({ voiceProposal: { current, proposed, added, removed } });
}

export function acceptVoiceProposal(): void {
  const view = editorBridge.view;
  const proposal = getState().voiceProposal;
  if (!view || !proposal) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: proposal.proposed }, userEvent: 'input.voice' });
  setState({ voiceProposal: null });
  toast('Voice guide updated. Earlier versions stay in your editor’s undo history.', 'success');
}
