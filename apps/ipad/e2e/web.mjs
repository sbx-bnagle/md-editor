// Tests the iPad web bundle (apps/ipad/dist/web) in Chromium, with mockShell.mjs answering for
// the Swift shell. Run after `npm run build:ipad`: node apps/ipad/e2e/web.mjs
// Covers the host's side: the backend in the page, the file stand-ins, the transport, menus,
// shortcuts, key stand-ins and streamed HTTP. The Swift side is tested in the iOS Simulator
// (.github/workflows/ipad.yml).
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createMockShell } from './mockShell.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', 'dist', 'web');
if (!existsSync(join(web, 'renderer', 'ipad-host.js'))) throw new Error('Build first: npm run build:ipad');
const shots = process.env.MDE_SHOTS ?? join(here, '..', 'test-results');
await mkdir(shots, { recursive: true });
const tmp = await mkdtemp(join(tmpdir(), 'folio-ipad-'));
const home = join(tmp, 'container');
await mkdir(join(home, 'Documents'), { recursive: true });
const step = (name) => console.log(`• ${name}`);

const KEY = 'sk-test-not-a-real-key';
const requests = [];
const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
async function http(req) {
  requests.push(req);
  if (req.url.startsWith('https://api.anthropic.com/v1/messages')) {
    if (req.headers['x-api-key'] !== KEY) return { status: 401, headers: { 'content-type': 'application/json' }, chunks: [JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })] };
    return {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      chunks: sse([
        ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'O' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'K' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
        ['message_stop', { type: 'message_stop' }],
      ]),
    };
  }
  return { status: 401, headers: { 'content-type': 'application/json' }, chunks: ['{"type":"error"}'] };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true });
let page;
const shell = createMockShell({ home, web, version: '0.9.0-test', selfTest: true, dialogs: { saveFolder: join(home, 'Documents') }, http, page: () => page, context: () => context });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
await context.route('http://folio.test/**', async (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = join(web, 'renderer', path);
  if (!file.startsWith(join(web, 'renderer')) || !existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
  return route.fulfill({ status: 200, body: await readFile(file), headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } });
});
await context.exposeBinding('__folioNative', (_source, message) => shell.handle(message));
await context.addInitScript(() => {
  window.webkit = { messageHandlers: { folio: { postMessage: (m) => window.__folioNative(m) } } };
});

const errors = [];
page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Content Security Policy|mde-asset|ERR_UNKNOWN_URL_SCHEME|Failed to load resource/.test(m.text())) errors.push(m.text());
});
const shot = (name) => page.screenshot({ path: join(shots, `ipad-${name}.png`) });

try {
  step('self test (the same one the Simulator build runs)');
  await page.goto('http://folio.test/index.html');
  const resultFile = join(home, 'Documents', 'selftest.json');
  const finished = async () => existsSync(resultFile) && JSON.parse(await readFile(resultFile, 'utf8')).done;
  for (let i = 0; i < 400 && !(await finished()); i++) await new Promise((r) => setTimeout(r, 200));
  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  assert.ok(result.done, 'both parts of the self test ran');
  for (const s of result.steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name} (${s.ms} ms)${s.detail ? `: ${s.detail.slice(0, 120)}` : ''}`);
  assert.ok(result.ok, 'every self-test step passes');
  const pdf = await readFile(join(home, 'Documents', 'Self Test Output', 'Test.pdf'));
  const pdfText = pdf.toString('latin1');
  assert.ok(pdfText.startsWith('%PDF-'), 'a PDF was written');
  assert.ok(!/pdfuaid:part/.test(pdfText), 'an untagged PDF does not claim PDF/UA');
  assert.ok(!/\/Marked true/.test(pdfText), 'an untagged PDF is not marked as tagged');
  assert.ok(/Self Test/.test(pdfText), 'the PDF carries its title');

  step('the UI shows the library after the self test');
  await page.waitForLoadState('load');
  await page.locator('.sidebar-tree').waitFor({ timeout: 20000 });
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('ipad')));
  // The self test's second part left main.md open in the preview.
  assert.equal(await page.locator('.doc-tab.active .doc-tab-name').innerText(), 'main.md');
  await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  await page.waitForTimeout(800);
  await shot('01-editor');

  step('typing and ⌘S save through the shell');
  await page.evaluate(() => document.querySelector('.cm-content')?.focus());
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('\n\nWritten on the iPad.\n');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(800);
  const libraryRoot = join(home, 'Documents', 'Folio Dome Library');
  const saved = await readFile(join(libraryRoot, 'Collections', 'Examples', 'Feature Tour', 'main.md'), 'utf8');
  assert.match(saved, /Written on the iPad\./);

  step('⌘E hides and shows the library (shortcut from the shared menus)');
  const hidden = () => page.evaluate(() => document.querySelector('.app')?.classList.contains('library-hidden'));
  const before = await hidden();
  await page.keyboard.press('Meta+e');
  await page.waitForTimeout(200);
  assert.notEqual(await hidden(), before);
  await page.keyboard.press('Meta+e');
  await page.waitForTimeout(200);
  assert.equal(await hidden(), before);

  step('right-click opens the in-page context menu; Escape closes it');
  // A line in view (the editor may be scrolled to where the preview was).
  const box = await page.locator('.cm-scroller').boundingBox();
  const line = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)?.closest('.cm-line');
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + 20, y: r.y + r.height / 2 } : null;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  assert.ok(line, 'a line in the middle of the editor');
  await page.mouse.click(line.x, line.y, { button: 'right' });
  await page.locator('.folio-menu').first().waitFor({ timeout: 5000 });
  const labels = await page.locator('.folio-menu').first().locator('.folio-menu-label').allInnerTexts();
  assert.ok(labels.includes('Insert HTML Entity'), `menu items: ${labels.join(', ')}`);
  assert.ok(labels.includes('Paste'));
  await page.locator('.folio-menu-item', { hasText: 'Insert HTML Entity' }).click();
  assert.equal(await page.locator('.folio-menu').count(), 2, 'the submenu opens beside the menu');
  await shot('02-context-menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.folio-menu-layer').count(), 0);

  step('touch and hold on a library row opens its menu, without opening the row');
  const row = page.locator('.tree-row', { hasText: /^Feature Tour$/ });
  const r = await row.boundingBox();
  const at = { x: r.x + 30, y: r.y + r.height / 2 };
  await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: at.x, clientY: at.y, bubbles: true, isPrimary: true });
  await page.waitForTimeout(700);
  await row.dispatchEvent('pointerup', { pointerType: 'touch', clientX: at.x, clientY: at.y, bubbles: true, isPrimary: true });
  await page.locator('.folio-menu').first().waitFor({ timeout: 3000 });
  const rowLabels = await page.locator('.folio-menu').first().locator('.folio-menu-label').allInnerTexts();
  assert.ok(rowLabels.includes('Show in Files'), `row menu: ${rowLabels.join(', ')}`);
  assert.ok(!rowLabels.includes('Tags'), 'no Finder tags on iPad');
  await page.locator('.folio-menu-item', { hasText: 'Show in Files' }).click();
  await page.waitForTimeout(100);
  assert.ok(shell.log.some((l) => l.startsWith('reveal ') && l.endsWith('Feature Tour')), 'reveal went to the shell');

  step('API key: stored by the shell, a stand-in in the page, the real key only in the request');
  const call = (method, ...args) => page.evaluate(([m, a]) => window.mdeHost.invoke(m, a), [method, args]);
  assert.equal((await call('ai.setKey', 'claude', KEY)).ok, true);
  assert.equal(shell.secrets.get('ai-key:claude'), KEY);
  assert.deepEqual((await call('ai.keyStatus')).value.claude, true);
  const reply = await call('ai.complete', { providerId: 'claude', purpose: 'test', system: 'Reply OK.', messages: [{ role: 'user', content: 'Say OK.' }], maxTokens: 16 });
  assert.equal(reply.ok, true, reply.message);
  assert.equal(reply.value.text, 'OK');
  const sent = requests.find((q) => q.url.startsWith('https://api.anthropic.com/v1/messages'));
  assert.equal(sent.headers['x-api-key'], KEY);
  const pageHasKey = await page.evaluate((k) => document.documentElement.outerHTML.includes(k), KEY);
  assert.equal(pageHasKey, false);

  step('streamed reply through the Assistant (ai-delta events)');
  const streamed = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let text = '';
        const off = window.mdeHost.subscribe((e) => {
          if (e.type === 'ai-delta') text += e.text;
          if (e.type === 'ai-done' || e.type === 'ai-error') {
            off();
            resolve({ text, type: e.type, message: e.message });
          }
        });
        window.mdeHost.invoke('ai.start', [{ providerId: 'claude', purpose: 'chat', system: 's', messages: [{ role: 'user', content: 'hi' }] }]);
      }),
  );
  assert.deepEqual(streamed, { text: 'OK', type: 'ai-done', message: undefined });

  step('a change made outside the app reaches the open document (watcher)');
  const mainPath = join(libraryRoot, 'Collections', 'Examples', 'Feature Tour', 'main.md');
  await page.waitForTimeout(500);
  const { writeFile } = await import('node:fs/promises');
  // In the text, not after the authorship block at the end of the file.
  await writeFile(mainPath, saved.replace('Written on the iPad.', 'Written on the iPad. Changed on the Mac.'));
  await shell.notify([mainPath]);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Changed on the Mac.'), null, { timeout: 8000 });

  step('preview renders pages');
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot('03-preview');
  await page.getByRole('tab', { name: 'Markdown', exact: true }).click();

  step('no page errors');
  assert.deepEqual(errors, []);
  console.log('iPad web bundle: all checks passed.');
} finally {
  await shot('99-last').catch(() => undefined);
  await shell.close();
  await browser.close();
  await rm(tmp, { recursive: true, force: true });
}
