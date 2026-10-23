// A check of the whole iPad host, run when the app is launched with -FolioSelfTest YES (the
// build on GitHub's Mac runners does this in the iOS Simulator). The first part works through
// the transport the UI uses, in a library in the app's Documents folder; the page then reloads
// and the second part uses the UI (open a document, show the preview). The results go to
// Documents/selftest.json, which the build reads back.

import { PDFDocument } from 'pdf-lib';
import { fromBase64, native } from './native';
import { promises as fs } from './shims/fs';
import './transport';

interface Step {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

interface Result {
  ok: boolean;
  done: boolean;
  version: string;
  userAgent: string;
  steps: Step[];
}

const PHASE_KEY = 'folio-selftest';

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const r = await window.mdeHost!.invoke(method, args);
  if (!r.ok) throw new Error(r.message ?? `${method} failed`);
  return r.value as T;
}

function recorder(steps: Step[]) {
  return async <T>(name: string, fn: () => Promise<T>, describe?: (v: T) => string): Promise<T | undefined> => {
    const t = performance.now();
    try {
      const v = await fn();
      steps.push({ name, ok: true, ms: Math.round(performance.now() - t), detail: describe?.(v) });
      return v;
    } catch (e) {
      steps.push({ name, ok: false, ms: Math.round(performance.now() - t), detail: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, get: () => T | null | undefined | false, timeoutMs = 20000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await wait(100);
  }
}

async function save(info: { home: string }, result: Result): Promise<void> {
  const docs = `${info.home}/Documents`;
  await fs.mkdir(docs, { recursive: true });
  await fs.writeFile(`${docs}/selftest.json`, `${JSON.stringify(result, null, 2)}\n`);
  native('log', { message: `SELFTEST ${JSON.stringify(result)}` }).catch(() => undefined);
}

/** Runs the part of the self test this page load is for (none when no test is running). */
export async function runSelfTest(info: { home: string; version: string; selfTest: boolean }): Promise<void> {
  const carried = sessionStorage.getItem(PHASE_KEY);
  if (carried) {
    sessionStorage.removeItem(PHASE_KEY);
    await uiPhase(info, JSON.parse(carried) as Result);
  } else if (info.selfTest) {
    await backendPhase(info);
  }
}

async function backendPhase(info: { home: string; version: string }): Promise<void> {
  const steps: Step[] = [];
  const step = recorder(steps);
  const out = `${info.home}/Documents/Self Test Output`;

  await step('ui booted', async () => waitFor('the UI', () => (document.querySelector('.welcome') ? 'welcome' : document.querySelector('.app') ? 'app' : null), 10000), (v) => v);
  const libraryPath = await step('default library path', () => call<string>('app.defaultLibraryPath'), (v) => v);
  await step('open library (create)', () => call('app.openLibrary', libraryPath, true));
  const tree = await step('library tree', () => call<{ collections: Array<{ name: string; path: string }> }>('library.tree'), (t) => `${t.collections.length} collections`);
  const collection = tree?.collections[0];
  const project = await step('create project', () => call<string>('library.createProject', { collection: collection?.name, name: `Self Test ${Date.now()}` }), (p) => p);
  const doc = project
    ? await step('create file', () => call<string>('files.createFile', project, 'Test.md', '---\ntitle: Self Test\n---\n\n# Heading\n\nSome text with “quotes”.\n'), (p) => p)
    : undefined;
  if (project && doc) {
    await step('save document', () => call('files.saveDocument', { path: doc, text: '---\ntitle: Self Test\n---\n\n# Heading\n\nEdited text.\n\n```mermaid\ngraph LR\n  A --> B\n```\n\n+++\n\n## Second page\n\nMore text.\n' }));
    await step('read document', () => call<{ text: string }>('files.readDocument', doc), (d) => `${d.text.length} chars`);
    await step('render', () => call<{ html: string }>('render.document', { docPath: doc }), (r) => `${r.html.length} chars of HTML`);
    await step('export PDF', () => call<{ path: string }>('exports.pdf', { docPath: doc, outPath: `${out}/Test.pdf` }), (r) => r.path);
    await step('PDF pages', async () => {
      const pdf = await PDFDocument.load(fromBase64(await native<string>('fs.read', { path: `${out}/Test.pdf`, encoding: 'base64' })));
      const pages = pdf.getPages().map((p) => p.getSize());
      if (pages.length < 2) throw new Error(`${pages.length} page(s); the document has a page break`);
      const { width, height } = pages[0];
      if (Math.abs(width - 612) > 2 || Math.abs(height - 792) > 2) throw new Error(`page size ${width} × ${height} pt, not US Letter`);
      return pages;
    }, (pages) => `${pages.length} pages, ${pages.map((p) => `${Math.round(p.width)}×${Math.round(p.height)}`).join(', ')}`);
    await step('export web page', () => call<{ path: string }>('exports.html', { docPath: doc, outPath: `${out}/Test.html` }), (r) => r.path);
    await step('checkpoint', () => call('history.checkpoint', project, 'Self test'));
    await step('history list', () => call<unknown[]>('history.list', project), (l) => `${l.length} versions`);
    await step('export ZIP', () => call<{ path: string }>('exports.zip', { projectPath: project, includeHistory: true, outPath: `${out}/Test.zip` }), (r) => r.path);
    await step('search', () => call<{ hits: unknown[] }>('library.search', 'Edited'), (r) => `${r.hits.length} hits`);
  }
  await step('thesaurus', () => call<unknown>('thesaurus.lookup', 'quick', {}), (r) => (r ? 'found' : 'none'));
  await step('themes', () => call<Array<{ name: string }>>('themes.list'), (l) => l.map((t) => t.name).join(', '));
  await step('spelling', async () => {
    const wrong = await window.mdeHost!.spell!.check(['speling', 'spelling']);
    if (!wrong.includes('speling') || wrong.includes('spelling')) throw new Error(JSON.stringify(wrong));
    return wrong;
  }, (w) => JSON.stringify(w));
  await step('key storage', async () => {
    await call('ai.setKey', 'claude', 'test-key-not-real');
    const status = await call<Record<string, boolean>>('ai.keyStatus');
    await call('ai.setKey', 'claude', null);
    const after = await call<Record<string, boolean>>('ai.keyStatus');
    if (!status.claude || after.claude) throw new Error(`stored: ${status.claude}, after removal: ${after.claude}`);
    return status;
  }, (s) => JSON.stringify(s));
  await step('native HTTP', () => fetchViaHost('https://api.anthropic.com/v1/models'), (s) => s);

  const result: Result = { ok: steps.every((s) => s.ok), done: false, version: info.version, userAgent: navigator.userAgent, steps };
  await save(info, result);
  // The second part runs in the reloaded page, with the library open in the UI.
  sessionStorage.setItem(PHASE_KEY, JSON.stringify(result));
  setTimeout(() => location.reload(), 300);
}

async function uiPhase(info: { home: string }, result: Result): Promise<void> {
  const step = recorder(result.steps);
  const rowNamed = (name: string) => [...document.querySelectorAll<HTMLElement>('.tree-row')].find((r) => r.textContent?.trim() === name);
  await step('ui: library shown', async () => waitFor('the library', () => document.querySelector('.sidebar-tree')));
  await step('ui: open main.md', async () => {
    (await waitFor('Examples', () => rowNamed('Examples'))).click();
    (await waitFor('Feature Tour', () => rowNamed('Feature Tour'))).click();
    (await waitFor('main.md', () => rowNamed('main.md'))).click();
    await waitFor('the editor', () => document.querySelector('.cm-content'));
    return document.querySelector('.cm-content')?.textContent?.length ?? 0;
  }, (n) => `${n} characters shown`);
  await step('ui: preview pages', async () => {
    const tab = await waitFor('the Preview tab', () => document.querySelector<HTMLElement>('[role="tab"][aria-label="Preview"]'));
    tab.click();
    const total = await waitFor('the page count', () => document.querySelector('.page-count:not(.rendering) .page-total')?.textContent?.match(/\d+/)?.[0], 40000);
    await wait(1500);
    return Number(total);
  }, (n) => `${n} pages`);
  result.ok = result.steps.every((s) => s.ok);
  result.done = true;
  await save(info, result);
}

/** A request through the shell's HTTP (no key: the API answers 401, which shows the round trip works). */
async function fetchViaHost(url: string): Promise<string> {
  const { nativeFetch } = await import('./http');
  const res = await nativeFetch(url, { headers: { 'anthropic-version': '2023-06-01' } });
  const text = await res.text();
  if (res.status !== 401) throw new Error(`status ${res.status}: ${text.slice(0, 80)}`);
  return `${res.status} ${text.slice(0, 60)}`;
}
