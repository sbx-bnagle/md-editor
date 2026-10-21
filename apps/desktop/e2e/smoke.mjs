// End-to-end smoke test: launches the built app with a temporary library and drives it.
// Linux: xvfb-run -a node apps/desktop/e2e/smoke.mjs   macOS: node apps/desktop/e2e/smoke.mjs
import { _electron as electron } from 'playwright';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
const menu = (command) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('mde:event', { type: 'menu', command: c }), command);

step('library seeded');
await page.locator('.sidebar-tree').waitFor();
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
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
const frame = page.frameLocator('.preview-frame.visible');
const pages = await frame.locator('.pagedjs_page').count();
assert.ok(pages >= 2, `expected at least 2 pages, got ${pages}`);
await shot('02-preview');
await page.getByRole('tab', { name: 'Markdown' }).click();

step('layout: view toggle on the left of the top bar, no breadcrumbs, no library footer');
assert.equal(await page.locator('.breadcrumbs').count(), 0);
assert.equal(await page.locator('.sidebar-footer').count(), 0);
assert.equal(await page.locator('.toolbar-left .segmented').count(), 1);
assert.equal(await page.locator('.sidebar').getByText('Collections', { exact: true }).count(), 0, 'no Collections label');
const editorBox = await page.locator('.cm-scroller').boundingBox();
const columnBox = await page.locator('.cm-content').boundingBox();
const ratio = columnBox.width / editorBox.width;
assert.ok(ratio > 0.72 && ratio < 0.78, `column takes ${Math.round(ratio * 100)}% of the editor`);
assert.equal(await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontSize), '20px');

step('scroll sync between the editor and the preview');
const longDoc = join(library, 'Collections/Examples/Feature Tour/long.md');
await writeFile(longDoc, '---\ntitle: Long\n---\n\n' + Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\n${'A sentence with enough words in it to wrap across the column. '.repeat(6)}\n`).join('\n'));
await page.locator('.tree-row', { hasText: /^long\.md$/ }).click();
await page.locator('.cm-line', { hasText: 'Section 1' }).first().waitFor();
const editorTo = (heading) =>
  page.locator('.cm-scroller').evaluate(async (sc, heading) => {
    // CodeMirror draws only the lines near the viewport: scroll in steps until the line exists.
    sc.scrollTop = 0;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const line = [...sc.querySelectorAll('.cm-line')].find((l) => l.textContent === heading);
      if (line) {
        sc.scrollTop += line.getBoundingClientRect().top - sc.getBoundingClientRect().top;
        return true;
      }
      sc.scrollTop += sc.clientHeight / 2;
    }
    return false;
  }, heading);
const editorTop = () =>
  page.locator('.cm-scroller').evaluate((sc) => {
    const top = sc.getBoundingClientRect().top;
    const lines = [...sc.querySelectorAll('.cm-line')].map((l) => ({ text: l.textContent, d: l.getBoundingClientRect().top - top }));
    return lines.filter((l) => l.text.startsWith('## ')).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
  });
const previewTop = () =>
  page.evaluate(() => {
    const doc = document.querySelector('iframe.preview-frame.visible').contentDocument;
    return [...doc.querySelectorAll('.pagedjs_page_content h2')].map((h) => ({ text: h.textContent, d: h.getBoundingClientRect().top })).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
  });
assert.ok(await editorTo('## Section 20'), 'editor scrolled to Section 20');
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(400);
const shownTop = await previewTop();
console.log(`  editor → preview: ${shownTop.text} at ${Math.round(shownTop.d)} px`);
assert.equal(shownTop.text, 'Section 20');
assert.ok(Math.abs(shownTop.d) < 40, 'heading at the top of the preview');
await page.evaluate(() => {
  const doc = document.querySelector('iframe.preview-frame.visible').contentDocument;
  [...doc.querySelectorAll('.pagedjs_page_content h2')].find((h) => h.textContent === 'Section 31').scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(400);
await page.getByRole('tab', { name: 'Markdown' }).click();
await page.waitForTimeout(200);
const backTop = await editorTop();
console.log(`  preview → editor: ${backTop.text} at ${Math.round(backTop.d)} px`);
assert.equal(backTop.text, '## Section 31');
assert.ok(Math.abs(backTop.d) < 40, 'heading at the top of the editor');
await rm(longDoc);

step('library search: names and text');
await menu('find-in-library');
await page.locator('#library-search').fill('footnote text');
await page.locator('.search-group-title', { hasText: 'Examples › Feature Tour' }).waitFor();
await page.locator('.search-hit-line', { hasText: 'This is the footnote text.' }).click();
await page.waitForFunction(() => window.getSelection()?.toString().toLowerCase() === 'footnote', null, { timeout: 15000 });
await shot('03-search');
await page.locator('#library-search').fill('chapters');
await page.getByRole('button', { name: 'chapters folder' }).click();
await page.locator('.tree-row', { hasText: /^details\.md$/ }).waitFor();
assert.equal(await page.locator('#library-search').inputValue(), '', 'opening a folder result clears the search');

step('text editing in the preview');
const editDoc = join(library, 'Collections/Examples/Feature Tour/edit.md');
const partDoc = join(library, 'Collections/Examples/Feature Tour/part.md');
await writeFile(partDoc, 'Included text here.\n');
await writeFile(editDoc, '---\ntitle: Edit\n---\n\n# Heading one\n\nA **bol** move and [a link](http://example.com).\n\n/part.md\n');
await page.locator('.tree-row', { hasText: /^edit\.md$/ }).click();
await page.locator('.cm-line', { hasText: 'Heading one' }).waitFor();
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
const preview = page.frameLocator('.preview-frame.visible');
await preview.locator('strong', { hasText: 'bol' }).dblclick();
await page.keyboard.type('bold');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('A **bold** move'), null, { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('iframe.preview-frame.visible')?.contentDocument.querySelector('strong')?.textContent === 'bold', null, { timeout: 30000 });
// An included file is changed on disk.
await page.frameLocator('.preview-frame.visible').locator('p', { hasText: 'Included text here.' }).dblclick({ position: { x: 20, y: 8 } });
await page.keyboard.type('Embedded');
await page.keyboard.press('Enter');
for (let i = 0; i < 50 && !(await readFile(partDoc, 'utf8')).startsWith('Embedded text here.'); i++) await page.waitForTimeout(200);
const part = await readFile(partDoc, 'utf8');
assert.ok(part.startsWith('Embedded text here.\n'), part);
// The typed letters are recorded as written by the person ("Embed" replaced "Inclu").
assert.match(part, /\n@[^:\n]+: 0,5\n/);
// A change that cuts through bold is refused and the text is put back.
await page.waitForFunction(() => document.querySelector('iframe.preview-frame.visible')?.contentDocument.body.textContent.includes('Embedded text here.'), null, { timeout: 30000 });
await page.frameLocator('.preview-frame.visible').locator('p', { hasText: 'move and' }).getByText('a link').dblclick();
await page.keyboard.press('Home');
for (let i = 0; i < 'A bold '.length; i++) await page.keyboard.press('ArrowRight');
for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
await page.keyboard.press('Enter');
await page.locator('.toast', { hasText: 'crosses formatting' }).waitFor();
assert.equal(await page.frameLocator('.preview-frame.visible').locator('p', { hasText: 'move and' }).textContent(), 'A bold move and a link.');
await page.screenshot({ path: join(shots, '04-preview-edit.png') });
await page.getByRole('tab', { name: 'Markdown' }).click();
await rm(editDoc);
await rm(partDoc);
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.locator('.tree-row.active', { hasText: /^main\.md$/ }).waitFor();

step('new collection from the + menu');
// Native menus cannot be clicked by Playwright: choose an item by label when the menu pops up.
await app.evaluate(({ Menu }) => {
  Menu.prototype.popup = function (opts) {
    const item = this.items.find((i) => i.label === globalThis.pickLabel && i.enabled);
    globalThis.pickLabel = null;
    item?.click();
    setTimeout(() => opts?.callback?.(), 0);
  };
});
await app.evaluate(() => (globalThis.pickLabel = 'New Collection…'));
await page.locator('.sidebar-titlebar .icon-button').click();
await page.locator('.modal h2', { hasText: 'New Collection' }).waitFor();
await page.locator('.modal input[type=text]').fill('Reports');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.locator('.sidebar-tree .tree-row', { hasText: /^Reports$/ }).waitFor();
assert.ok(existsSync(join(library, 'Collections', 'Reports')), 'collection folder created');

step('theme menu in the bottom bar');
await page.locator('.statusbar .status-button', { hasText: 'Theme: Classic' }).click();
await page.locator('.theme-popover .popover-heading', { hasText: 'Edit theme' }).waitFor();
await page.waitForTimeout(200);
await shot('03-theme-menu');
await page.keyboard.press('Escape');

step('guides menu in the bottom bar');
await page.locator('.statusbar .guides-button').click();
await page.locator('.guides-popover .popover-item', { hasText: 'New voice guide…' }).waitFor();
await shot('03b-guides-menu');
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
await page.locator('.tree-row.active', { hasText: /^main\.md$/ }).waitFor();
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
await shot('06-template-preview');

step('template from a project, then a project from that template');
await page.getByRole('tab', { name: 'Markdown' }).click();
await menu('new-template');
await page.locator('.modal h2', { hasText: 'New Template from Project' }).waitFor();
await page.locator('.modal input[type=text]').fill('Acme Base');
await page.getByRole('button', { name: 'Create Template' }).click();
await page.locator('.modal').waitFor({ state: 'detached' });
assert.ok(existsSync(join(library, 'Templates', 'Acme Base', 'main.md')), 'template copied from the project');
assert.ok(!existsSync(join(library, 'Templates', 'Acme Base', '.mdeditor', 'history.mdh')), 'template has no history');
await menu('new-project-from-template');
await page.locator('.modal h2', { hasText: 'New Project from Template' }).waitFor();
await page.locator('.modal input[type=text]').fill('Acme Q1');
await page.locator('.modal select').nth(1).selectOption('Acme Base');
await page.getByRole('button', { name: 'Create Project' }).click();
await page.locator('.tree-row', { hasText: /^Acme Q1$/ }).waitFor();
assert.ok(existsSync(join(library, 'Collections', 'Clients', 'Acme Q1', 'main.md')), 'project created from the new template');

step('theme CSS editing');
await page.getByRole('tab', { name: 'Markdown' }).click();
await page.locator('.statusbar .status-button', { hasText: 'Theme:' }).click();
await page.locator('.theme-popover .popover-item[title^="Edit the library theme"]', { hasText: 'Modern' }).click();
await page.locator('.cm-code').waitFor();
await page.locator('.status-file', { hasText: 'Theme “Modern”' }).waitFor();
await shot('07-theme-css');
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
await shot('08-theme-preview');

step('library-level history for themes');
if (!(await page.locator('.history-panel').count())) await page.locator('button[title^="History"]').click();
await page.locator('.panel-project', { hasText: 'All themes in the library' }).waitFor();
await page.getByRole('button', { name: 'Checkpoint…' }).click();
await page.locator('.modal input[type=text]').fill('Theme baseline');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.locator('.history-name', { hasText: 'Theme baseline' }).waitFor();
assert.ok(existsSync(join(library, 'Themes', '.mdeditor', 'history.mdh')), 'Themes history file');

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
  await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? '') && document.querySelector('.tree-row.active')?.textContent === 'asset-test.md', null, { timeout: 30000 });
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
