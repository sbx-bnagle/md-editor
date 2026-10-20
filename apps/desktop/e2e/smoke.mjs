// End-to-end smoke test: launches the built app with a temporary library and drives it.
// Linux: xvfb-run -a node apps/desktop/e2e/smoke.mjs   macOS: node apps/desktop/e2e/smoke.mjs
import { _electron as electron } from 'playwright';
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const shots = process.env.MDE_SHOTS ?? join(appDir, 'test-results');
const tmp = await mkdtemp(join(tmpdir(), 'mde-e2e-'));
const library = join(tmp, 'Library');
const electronBin = (await import('electron')).default;

const app = await electron.launch({
  executablePath: electronBin,
  args: [appDir, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, MDE_LIBRARY: library, MDE_USER_DATA: join(tmp, 'userData'), MDE_IDLE_MS: '1500' },
});
const errors = [];
const page = await app.firstWindow();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const step = (name) => console.log(`• ${name}`);

step('library seeded');
await page.getByText('Collections', { exact: true }).waitFor();
await page.getByText('Examples', { exact: true }).click();
await page.getByText('Feature Tour', { exact: true }).click();
await page.getByText('main.md', { exact: true }).click();
await page.locator('.cm-content').waitFor();
await page.waitForTimeout(800);
await shot('01-editor');

step('curly quotes while typing; straight inside HTML tags and code');
const editor = page.locator('.cm-content');
await page.evaluate(() => {
  const view = document.querySelector('.cm-content');
  view?.focus();
});
await page.keyboard.press('ControlOrMeta+End');
await page.keyboard.type('\n\nShe said "hello" and it\'s fine. <a href="x">link</a> `code "q"`\n');
await page.waitForTimeout(300);
const text = await editor.innerText();
assert.match(text, /She said “hello” and it’s fine\. <a href="x">link<\/a> `code "q"`/);

step('autosave');
await page.waitForTimeout(1500);
const saved = await readFile(join(library, 'Collections/Examples/Feature Tour/main.md'), 'utf8');
assert.match(saved, /She said “hello” and it’s fine/);

step('preview renders pages with running headers');
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.page-count')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
const frame = page.frameLocator('.preview-frame.visible');
const pages = await frame.locator('.pagedjs_page').count();
assert.ok(pages >= 2, `expected at least 2 pages, got ${pages}`);
await shot('02-preview');
await page.getByRole('tab', { name: 'Markdown' }).click();

step('theme popover');
await page.locator('.toolbar-button', { hasText: 'Classic' }).click();
await page.waitForTimeout(200);
await shot('03-theme-menu');
await page.keyboard.press('Escape');

step('PDF export through the host API');
const pdfPath = join(tmp, 'out', 'tour.pdf');
const r = await page.evaluate(
  ([doc, out]) => window.mdeHost.invoke('exports.pdf', [{ docPath: doc, outPath: out }]),
  [join(library, 'Collections/Examples/Feature Tour/main.md'), pdfPath],
);
assert.equal(r.ok, true, r.message);
assert.ok((await stat(pdfPath)).size > 1000);

step('history panel with checkpoint');
await page.locator('button[title^="History"]').click();
await page.getByRole('button', { name: 'Checkpoint…' }).click();
await page.locator('.modal input[type=text]').fill('Before review');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.getByText('Before review').first().waitFor();
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+End');
await page.keyboard.type('A sentence added after the checkpoint.\n');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Checkpoint…' }).click();
await page.locator('.modal input[type=text]').fill('After edit');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.getByText('After edit').first().click();
await page.locator('.history-file').first().waitFor();
await page.waitForTimeout(300);
await shot('04-history');
await page.locator('.history-file').first().click();
await page.locator('.diff-line.add').first().waitFor();
await page.waitForTimeout(300);
await shot('05-diff');
await page.locator('.diff-view .icon-button[aria-label=Close]').click();

step('new project from template');
await page.locator('.sidebar-titlebar .icon-button').click().catch(() => undefined);
await page.keyboard.press('Escape').catch(() => undefined);
await page.evaluate(() => window.mdeHost.invoke('library.createCollection', ['Clients']));
const created = await page.evaluate(() => window.mdeHost.invoke('library.createProject', [{ collection: 'Clients', name: 'Acme Q4', template: 'Report' }]));
assert.equal(created.ok, true, created.message);
await page.getByText('Clients', { exact: true }).click();
await page.getByText('Acme Q4', { exact: true }).click();
// Clients sorts before Examples, so the first main.md row belongs to Acme Q4.
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.waitForFunction(() => document.querySelector('.breadcrumbs')?.textContent?.includes('Acme Q4'));
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.page-count')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
await shot('06-template-preview');

step('theme CSS editing');
await page.getByRole('tab', { name: 'Markdown' }).click();
await page.locator('.sidebar-section', { hasText: 'Themes' }).getByText('Modern', { exact: true }).click();
await page.locator('.cm-code').waitFor();
await shot('07-theme-css');
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.page-count')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
await shot('08-theme-preview');

step('theme-local font and margin-box image load through the asset protocol');
const fontSrc = ['/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', '/System/Library/Fonts/Supplemental/Georgia.ttf'].find((f) => existsSync(f));
if (fontSrc) {
  const themeDir = join(library, 'Themes', 'AssetTest');
  await mkdir(join(themeDir, 'fonts'), { recursive: true });
  await copyFile(fontSrc, join(themeDir, 'fonts', 'test.ttf'));
  await writeFile(join(themeDir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="12"><rect width="40" height="12" fill="#c00"/></svg>');
  await writeFile(join(themeDir, 'theme.css'), '@font-face { font-family: "ThemeTestFont"; src: url("fonts/test.ttf"); }\n@page { size: letter; @top-left { content: url("logo.svg"); } }\nhtml { font-family: "ThemeTestFont", serif; }\n');
  const docPath = join(library, 'Collections/Clients/Acme Q4/asset-test.md');
  await writeFile(docPath, '---\ntheme: AssetTest\n---\n\nFont test.\n');
  await page.waitForTimeout(800);
  await page.locator('.tree-row', { hasText: /^asset-test\.md$/ }).first().click();
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.page-count')?.textContent ?? '') && document.querySelector('.breadcrumbs')?.textContent?.includes('asset-test'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const preview = page.frames().find((f) => f.url().includes('preview.html') && f !== page.mainFrame());
  const assetCheck = await page.evaluate(async () => {
    const frames = [...document.querySelectorAll('iframe.preview-frame.visible')];
    const doc = frames[0].contentDocument;
    await doc.fonts.ready;
    const box = doc.querySelector('.pagedjs_margin-top-left .pagedjs_margin-content');
    const para = doc.querySelector('.pagedjs_page_content p');
    return { font: doc.fonts.check('12px ThemeTestFont'), content: box ? getComputedStyle(box, '::after').content : null, color: para ? getComputedStyle(para).color : null };
  });
  assert.equal(assetCheck.font, true, 'theme font did not load');
  assert.match(String(assetCheck.content), /url\("?mde-asset:/, `margin box content: ${assetCheck.content}`);
  assert.equal(assetCheck.color, 'rgb(0, 0, 0)', 'unstyled text should default to black');
  void preview;
  await shot('09-theme-assets');
}

const errorToasts = await page.locator('.toast.error').allInnerTexts();
assert.deepEqual(errorToasts, [], `error toasts: ${errorToasts.join(' | ')}`);
await app.close();
const real = errors.filter((e) => !/Autofill|DevTools|dictionary|spellcheck/i.test(e));
if (real.length) console.log('Console errors:\n' + real.join('\n'));
console.log(`OK — library at ${library}, PDF at ${pdfPath}`);
