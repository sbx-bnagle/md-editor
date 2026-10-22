// End-to-end test for iteration 2: AI command bar, chat, review, headlines, checks,
// settings. A local mock serves the OpenAI-compatible API, so no real AI service is used.
// Linux: xvfb-run -a node apps/desktop/e2e/writing.mjs
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const shots = process.env.MDE_SHOTS ?? join(appDir, 'test-results');
const tmp = await mkdtemp(join(tmpdir(), 'mde-e2e2-'));
const library = join(tmp, 'Library');
const electronBin = (await import('electron')).default;

// ---- mock AI ----
let lastRequest = '';
function replyFor(body) {
  lastRequest = JSON.stringify(body.messages);
  const all = JSON.stringify(body.messages);
  if (all.includes('Review the document against the guides')) {
    return JSON.stringify({ issues: [{ quote: 'This document shows what the editor', message: 'Lead with what the reader gets.', suggestion: 'See what the editor' }] });
  }
  if (all.includes('Suggest 5 alternative headlines')) {
    return JSON.stringify({ alternatives: [{ text: 'How variables fill your pages', why: 'Names the benefit' }] });
  }
  if (all.includes('Write text to insert at the cursor')) return 'An AI drafted sentence.';
  if (all.includes('Rewrite the selection')) return 'Rewritten by AI.';
  return 'Here is a draft:\n\n```insert\nA paragraph from the chat.\n```\n';
}
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url.startsWith('/v1/chat/completions')) {
      const text = replyFor(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of text.match(/[\s\S]{1,12}/g)) res.write(`data: ${JSON.stringify({ model: 'mock-model', choices: [{ delta: { content: piece } }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } else if (req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const mockUrl = `http://127.0.0.1:${server.address().port}/v1`;

const app = await electron.launch({
  executablePath: electronBin,
  args: [appDir, ...(process.platform === 'linux' ? ['--no-sandbox', '--password-store=basic'] : [])],
  env: { ...process.env, MDE_LIBRARY: library, MDE_USER_DATA: join(tmp, 'userData'), MDE_TEST_PLAINTEXT_KEYS: '1' },
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const step = (name) => console.log(`• ${name}`);
const menu = (command) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('mde:event', { type: 'menu', command: c }), command);
const invoke = (method, args) => page.evaluate(([m, a]) => window.mdeHost.invoke(m, a), [method, args]);

step('configure an OpenAI-compatible service (mock) as the default');
await page.locator('.sidebar-tree').waitFor();
let r = await invoke('settings.update', [{ authorName: 'Tester', ai: { defaultProvider: 'local', providers: [{ id: 'local', kind: 'openai-compatible', name: 'Mock', baseUrl: mockUrl, model: 'mock-model', effort: 'default' }] } }]);
assert.equal(r.ok, true, r.message);
r = await invoke('ai.setKey', ['local', 'sk-test']);
assert.equal(r.ok, true, r.message);
await page.reload();
await page.locator('.sidebar-tree').waitFor();

step('settings dialog');
await menu('settings');
await page.getByRole('tab', { name: 'AI', exact: true }).click();
await page.getByText('saved in the Keychain').waitFor();
await page.getByRole('button', { name: 'Test connection' }).click();
await page.getByText(/Connected: mock-model/).waitFor();
await shot('20-settings-ai');
await page.keyboard.press('Escape');

step('open document; guides from project settings');
await page.getByText('Examples', { exact: true }).click();
await page.getByText('Feature Tour', { exact: true }).click();
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.locator('.cm-content').waitFor();
await page.getByText('Plain and direct · AP-like with serial comma').waitFor();

step('typed dashes and grammar/style underlines');
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+End');
await page.keyboard.type('\n\nIt takes 8-24 weeks -- maybe less. This are a test, apples, pears and plums.\n');
await page.waitForTimeout(300);
assert.match(await page.locator('.cm-content').innerText(), /8-24 weeks – maybe less/);
await page.locator('.cm-lintRange.cm-style').first().waitFor({ timeout: 15000 });
await page.locator('.cm-lintRange.cm-grammar').first().waitFor({ timeout: 30000 });
await page.locator('.cm-lintRange.cm-grammar').first().hover();
await page.locator('.cm-tooltip-lint').waitFor();
await shot('21-checks');

step('command bar writes at the cursor and records authorship');
await page.mouse.move(10, 10);
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+End');
await menu('ai-command');
await page.locator('.command-bar textarea').fill('Add a closing line');
await page.keyboard.press('Enter');
await page.locator('.command-output:not(.streaming)').waitFor();
await shot('22-command-bar');
await page.getByRole('button', { name: 'Insert', exact: true }).click();
await page.locator('.cm-ai-text', { hasText: 'An AI drafted sentence.' }).waitFor();
await page.waitForTimeout(1500);
const saved = await readFile(join(library, 'Collections/Examples/Feature Tour/main.md'), 'utf8');
assert.match(saved, /\n---\nAnnotations: 0,\d+ SHA-256 [0-9a-f]+\n@Tester: [\d, ]+\n&mock-model: \d+,23\n\.\.\.\n$/);

step('authorship view toggle');
await page.getByRole('button', { name: /AI text shown/ }).click();
await page.locator('.editor-host.authorship-hidden').waitFor();
await page.getByRole('button', { name: /AI text hidden/ }).click();

step('chat panel inserts a draft');
await page.getByRole('button', { name: 'Assistant', exact: true }).click();
await page.locator('.chat-compose textarea').fill('Draft a closing paragraph');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Insert at cursor' }).waitFor();
await shot('23-assistant');
await page.getByRole('button', { name: 'Insert at cursor' }).click();
await page.locator('.cm-ai-text', { hasText: 'A paragraph from the chat.' }).waitFor();

step('reference files: an RFP added to the project is sent with requests');
const rfp = join(tmp, 'RFP.txt');
await writeFile(rfp, 'Request for proposal: responses must include a staffing plan.\n');
await app.evaluate(({ dialog }, p) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
}, rfp);
await page.getByRole('button', { name: 'Add files…' }).click();
await page.locator('.reference-row', { hasText: 'RFP.txt' }).waitFor();
await page.getByText(/1 included/).waitFor();
assert.equal(await readFile(join(library, 'Collections/Examples/Feature Tour/References/RFP.txt'), 'utf8'), 'Request for proposal: responses must include a staffing plan.\n');
await page.locator('.chat-compose textarea').fill('What must the response include?');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Insert at cursor' }).nth(1).waitFor();
assert.match(lastRequest, /<reference name=\\"References\/RFP\.txt\\">\\nRequest for proposal: responses must include a staffing plan/);
await shot('26-references');
// Unticked references are not sent.
await page.locator('.reference-row', { hasText: 'RFP.txt' }).locator('input[type=checkbox]').uncheck();
await page.getByText('none included').waitFor();
await page.locator('.chat-compose textarea').fill('And now?');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Insert at cursor' }).nth(2).waitFor();
assert.doesNotMatch(lastRequest, /staffing plan/);

step('chats are kept per project, on disk');
const tourChat = join(library, 'Collections/Examples/Feature Tour/.mdeditor/chat.json');
// Wait for the last reply to finish (and be saved).
await page.waitForFunction(() => document.querySelectorAll('.chat-turn').length === 6 && ![...document.querySelectorAll('.chat-compose button')].some((b) => b.textContent === 'Stop'));
await page.waitForTimeout(300);
const savedChat = JSON.parse(await readFile(tourChat, 'utf8'));
assert.deepEqual(savedChat.turns.map((t) => t.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'], 'saved in the project');
assert.equal(savedChat.turns[0].doc, 'main.md');
assert.equal(await page.locator('.assistant-panel .panel-project').innerText(), 'Feature Tour');
assert.deepEqual(await page.locator('.chat-doc').allInnerTexts(), ['main.md'], 'the document is named once');
// Another project has its own conversation.
const second = join(library, 'Collections/Examples/Second Project');
await mkdir(join(second, '.mdeditor'), { recursive: true });
await writeFile(join(second, '.mdeditor/project.json'), JSON.stringify({ kind: 'project', created: new Date().toISOString() }));
await writeFile(join(second, 'second.md'), '# Second\n');
await page.locator('.tree-row', { hasText: /^Second Project$/ }).click();
await page.locator('.tree-row', { hasText: /^second\.md$/ }).click();
await page.waitForFunction(() => document.querySelector('.assistant-panel .panel-project')?.textContent === 'Second Project');
assert.equal(await page.locator('.chat-turn').count(), 0, 'a new project starts with an empty chat');
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.waitForFunction(() => document.querySelector('.assistant-panel .panel-project')?.textContent === 'Feature Tour' && document.querySelectorAll('.chat-turn').length === 6);
// A change to the file (another Mac, through a sync service) shows up.
await writeFile(tourChat, JSON.stringify({ format: 1, turns: [...savedChat.turns, { role: 'user', content: 'Sent from another Mac' }] }));
await page.locator('.chat-turn', { hasText: 'Sent from another Mac' }).waitFor();
// Clear Chat… asks, then empties the conversation and the file.
await app.evaluate(({ dialog }) => {
  dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
});
await page.getByRole('button', { name: 'Clear Chat…' }).click();
await page.waitForFunction(() => document.querySelectorAll('.chat-turn').length === 0);
await page.waitForTimeout(300);
assert.deepEqual(JSON.parse(await readFile(tourChat, 'utf8')).turns, []);

step('insights: readability, headlines with AI alternatives, AI review');
await page.locator('.panel-top .panel-toggles').getByRole('tab', { name: 'Insights', exact: true }).click();
await page.locator('.grade-badge').waitFor();
await page.getByRole('button', { name: /Review with AI/ }).click();
await page.getByText(/1 suggestion, underlined in amber/).waitFor();
await page.locator('.insight-item', { hasText: 'Lead with what the reader gets' }).click();
await page.waitForTimeout(1500);
assert.equal(await page.locator('.cm-lintRange.cm-grammar', { hasText: '## Content blocks' }).count(), 0, 'title-case rule should be off');
await page.locator('.cm-lintRange.cm-review').first().waitFor({ timeout: 10000 });
await page.locator('.headline-main', { hasText: 'Variables' }).click();
await page.getByRole('button', { name: 'Suggest alternatives' }).click();
await page.getByText('How variables fill your pages').waitFor();
await shot('24-insights');

step('readability highlighting');
await page.getByText(/Highlight sentences above grade/).click();
await page.waitForTimeout(1500);
await shot('25-readability');

step('rewrite a selection');
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+Home');
await page.keyboard.press('Shift+End');
await menu('ai-command');
await page.locator('.command-bar textarea').fill('Shorter');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Replace', exact: true }).click();
await page.locator('.cm-ai-text', { hasText: 'Rewritten by AI.' }).waitFor();

step('thesaurus in the context menu of a selected word');
// Native menus cannot be clicked by Playwright: record the menu and choose an item by label.
await app.evaluate(({ Menu }) => {
  Menu.prototype.popup = function (opts) {
    const describe = (m) => m.items.map((i) => ({ label: i.label, enabled: i.enabled, submenu: i.submenu ? describe(i.submenu) : undefined }));
    globalThis.lastMenu = describe(this);
    const find = (m) => {
      for (const i of m.items) {
        if (i.label === globalThis.pickLabel && i.enabled) return i;
        const f = i.submenu && find(i.submenu);
        if (f) return f;
      }
      return null;
    };
    find(this)?.click();
    setTimeout(() => opts?.callback?.(), 0);
  };
});
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+End');
await page.keyboard.type('\nThe fox walked home.');
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
const box = await page.evaluate(() => {
  const sel = window.getSelection();
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: sel.toString() };
});
assert.equal(box.text, 'walked');
await app.evaluate(() => (globalThis.pickLabel = 'marched'));
await page.mouse.click(box.x, box.y, { button: 'right' });
await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('The fox marched home.'), null, { timeout: 15000 });
const lastMenu = await app.evaluate(() => globalThis.lastMenu);
// A selection offers Ask AI first, then the thesaurus.
assert.equal(lastMenu[0].label, 'Ask AI…');
assert.equal(lastMenu[2].label, 'Synonyms for “walked”');
for (const label of ['Insert HTML Entity', 'Emoji & Symbols…', 'Insert Inline Image']) assert.ok(lastMenu.some((i) => i.label === label), label);
const thesaurusMenu = lastMenu.find((i) => i.label === 'Thesaurus');
assert.ok(thesaurusMenu?.submenu?.length > 0, 'thesaurus submenu has senses');
assert.match(thesaurusMenu.submenu[0].label, /^verb /);
console.log(`  menu: ${lastMenu.slice(0, 8).map((i) => i.label).join(' | ')}`);

step('voice refinement proposal');
await page.locator('.statusbar .guides-button').click();
await page.locator('.guides-popover .popover-item[title^="Edit"]', { hasText: 'Plain and direct' }).click();
await page.locator('.status-file', { hasText: 'Voice guide “Plain and direct”' }).waitFor();
await page.getByRole('button', { name: /Refine from edits/ }).waitFor();

const errorToasts = await page.locator('.toast.error').allInnerTexts();
assert.deepEqual(errorToasts, [], `error toasts: ${errorToasts.join(' | ')}`);
await app.close();
server.close();
if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
console.log('OK');
