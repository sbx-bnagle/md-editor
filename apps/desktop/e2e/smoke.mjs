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
// Native menus cannot be clicked by Playwright: choose an item by label when the menu pops up.
await app.evaluate(({ Menu }) => {
  Menu.prototype.popup = function (opts) {
    const find = (m) => {
      for (const i of m.items) {
        if (i.label === globalThis.pickLabel && i.enabled) return i;
        const f = i.submenu && find(i.submenu);
        if (f) return f;
      }
      return null;
    };
    const item = find(this);
    globalThis.pickLabel = null;
    item?.click();
    setTimeout(() => opts?.callback?.(), 0);
  };
});

step('library seeded');
await page.locator('.sidebar-tree').waitFor();
await page.getByText('Examples', { exact: true }).click();
await page.getByText('Feature Tour', { exact: true }).click();
await page.locator('.tree-row', { hasText: /^main\.md$/ }).click();
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
await page.getByRole('tab', { name: 'Preview', exact: true }).click();
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
const frame = page.frameLocator('.preview-frame.visible');
const pages = await frame.locator('.pagedjs_page').count();
assert.ok(pages >= 2, `expected at least 2 pages, got ${pages}`);
const greys = await page.evaluate(() => ({
  preview: getComputedStyle(document.querySelector('.preview-frame.visible').contentDocument.body).backgroundColor,
  editor: getComputedStyle(document.querySelector('.workspace')).backgroundColor,
}));
assert.equal(greys.preview, greys.editor, 'the preview shows pages on the editor grey');
await shot('02-preview');
await page.getByRole('tab', { name: 'Markdown', exact: true }).click();

step('layout: view toggle on the left of the top bar, no breadcrumbs, no library footer');
assert.equal(await page.locator('.breadcrumbs').count(), 0);
assert.equal(await page.locator('.sidebar-footer').count(), 0);
assert.equal(await page.locator('.toolbar-left .segmented').count(), 1);
assert.equal(await page.locator('.sidebar').getByText('Collections', { exact: true }).count(), 0, 'no Collections label');
const editorBox = await page.locator('.cm-scroller').boundingBox();
const columnBox = await page.locator('.cm-content').boundingBox();
const ratio = columnBox.width / editorBox.width;
assert.ok(ratio > 0.8 && ratio < 0.85, `column takes ${Math.round(ratio * 100)}% of the editor`);
assert.equal(await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontSize), '22px');
const bars = await page.evaluate(() => {
  const css = (sel) => getComputedStyle(document.querySelector(sel));
  const mid = (sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return r.top + r.height / 2;
  };
  return {
    rules: [css('.toolbar').borderBottomWidth, css('.statusbar').borderTopWidth, css('.sidebar-search').borderTopWidth],
    backgrounds: [css('.toolbar').backgroundColor, css('.statusbar').backgroundColor, css('.workspace').backgroundColor],
    searchMid: mid('.sidebar-search input'),
    statusMid: mid('.statusbar'),
  };
});
assert.deepEqual(bars.rules, ['0px', '0px', '0px'], 'no rules on the top bar, bottom bar or above the search field');
assert.ok(Math.abs(bars.searchMid - bars.statusMid) <= 1, `search text and bottom bar text line up (${bars.searchMid} vs ${bars.statusMid})`);

step('tabs: click replaces the tab, ⌘-click and Open in New Tab add one, ⌘T, ⌘W, ⌃Tab, undo kept');
const tabNames = () => page.locator('.doc-tab-name').allInnerTexts();
const activeTab = () => page.locator('.doc-tab.active .doc-tab-name').innerText();
assert.deepEqual(await tabNames(), ['main.md']);
// Typing in main.md, then visiting another tab and coming back keeps the undo history.
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+End');
await page.keyboard.type(' Tab marker.');
await page.locator('.tree-row', { hasText: /^chapters$/ }).first().click();
const chapter = page.locator('.tree-row.compact').filter({ hasText: /\.md$/ }).filter({ hasNotText: 'main.md' }).first();
await chapter.waitFor();
const chapterName = (await chapter.innerText()).trim();
await chapter.click({ modifiers: ['Meta'] });
await page.waitForFunction((n) => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === n, chapterName);
assert.deepEqual(await tabNames(), ['main.md', chapterName], '⌘-click opens a new tab after the current one');
await page.locator('.doc-tab-name', { hasText: /^main\.md$/ }).click();
await page.locator('.cm-content', { hasText: 'Tab marker.' }).waitFor();
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+z');
await page.waitForTimeout(200);
assert.ok(!(await page.locator('.cm-content').innerText()).includes('Tab marker.'), 'undo history kept across tab switches');
await page.waitForTimeout(1200);
// ⌃Tab shows the next tab.
await page.keyboard.press('Control+Tab');
await page.waitForFunction((n) => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === n, chapterName);
// A file already open in a tab is shown there, not opened twice.
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.waitForFunction(() => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === 'main.md');
assert.equal((await tabNames()).length, 2);
// Closing a background tab with its × leaves the current one.
await page.locator('.doc-tab', { hasText: chapterName }).locator('.doc-tab-close').click();
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 1);
assert.equal(await activeTab(), 'main.md');
// ⌘T: an empty tab; the next file chosen opens in it.
await menu('new-tab');
await page.locator('.doc-tab.active', { hasText: 'New Tab' }).waitFor();
await page.locator('.empty-state').waitFor();
await chapter.click();
await page.waitForFunction((n) => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === n, chapterName);
assert.deepEqual(await tabNames(), ['main.md', chapterName], 'a file chosen in an empty tab opens there');
await menu('close-tab');
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 1);
assert.equal(await activeTab(), 'main.md');
// Right-click › Open in New Tab.
await app.evaluate(() => (globalThis.pickLabel = 'Open in New Tab'));
await chapter.click({ button: 'right' });
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 2);
await shot('02c-tabs');
// A plain click on a file that is not open replaces the document in the current tab.
const extraDoc = join(library, 'Collections/Examples/Feature Tour/extra.md');
await writeFile(extraDoc, '# Extra\n');
await page.locator('.doc-tab-name', { hasText: /^main\.md$/ }).click();
await page.locator('.tree-row', { hasText: /^extra\.md$/ }).click();
await page.waitForFunction(() => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === 'extra.md');
assert.deepEqual(await tabNames(), ['extra.md', chapterName], 'plain click replaces the current tab');
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.waitForFunction(() => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === 'main.md');
await rm(extraDoc);
await page.locator('.doc-tab-name', { hasText: chapterName }).click();
await page.waitForFunction((n) => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === n, chapterName);
await menu('close-tab');
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 1);
// + in the tab bar is New File… (⌘N): the new file opens in a new tab.
await page.locator('.doc-tab-new').click();
await page.locator('.modal h2', { hasText: 'New File' }).waitFor();
await page.locator('.modal input[type=text]').fill('plus.md');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.waitForFunction(() => document.querySelector('.doc-tab.active .doc-tab-name')?.textContent === 'plus.md');
assert.deepEqual(await tabNames(), ['main.md', 'plus.md']);
await menu('close-tab');
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 1);
await rm(join(library, 'Collections/Examples/Feature Tour/plus.md'));
const settings = JSON.parse(await readFile(join(tmp, 'userData', 'settings.json'), 'utf8').catch(() => '{}'));
assert.deepEqual(settings.openTabs?.paths?.map((p) => p && p.split('/').pop()), ['main.md'], `tabs saved for the next session (${JSON.stringify(settings.openTabs)})`);

step('⌘E hides and shows the library');
await menu('toggle-library');
await page.waitForFunction(() => !document.querySelector('.sidebar'));
assert.ok(await page.locator('.app.library-hidden').count(), 'top bar leaves room for the window buttons');
await menu('toggle-library');
await page.locator('.sidebar-tree').waitFor();

step('find and replace: select all occurrences, next occurrence, Replace All');
// The editor's text, with blank lines collapsed (innerText renders an empty line as two breaks).
const editorText = async () => (await page.locator('.cm-content').innerText()).replace(/\n+/g, '\n').trim();
const occDoc = join(library, 'Collections/Examples/Feature Tour/occurrences.md');
await writeFile(occDoc, 'alpha beta alpha gamma alpha\n\nbeta alpha\n');
await page.locator('.tree-row', { hasText: /^occurrences\.md$/ }).click();
await page.locator('.cm-content', { hasText: 'gamma' }).waitFor();
await page.locator('.cm-content').click();
await page.evaluate(() => {
  const sel = window.getSelection();
  const text = [...document.querySelectorAll('.cm-line')][0].firstChild;
  const r = document.createRange();
  r.setStart(text, 0);
  r.setEnd(text, 5);
  sel.removeAllRanges();
  sel.addRange(r);
});
await page.waitForTimeout(100);
await page.keyboard.press('ControlOrMeta+Shift+L');
await page.waitForTimeout(100);
assert.equal(await page.locator('.cm-selectionBackground').count(), 4, 'every “alpha” selected');
await page.keyboard.type('omega');
await page.waitForTimeout(100);
assert.equal(await editorText(), 'omega beta omega gamma omega\nbeta omega');
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('one two one two one');
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('ControlOrMeta+d');
await page.keyboard.type('1');
await page.waitForTimeout(100);
assert.equal(await editorText(), '1 two 1 two one', '⌘D adds the next occurrence');
await menu('find-replace');
await page.locator('.cm-search input[name=search]').waitFor();
await page.keyboard.type('two');
await page.locator('.cm-search input[name=replace]').click();
await page.keyboard.type('2');
await page.keyboard.press('ControlOrMeta+Alt+Enter');
await page.waitForTimeout(100);
assert.equal(await editorText(), '1 2 1 2 one', 'Replace All');
await page.keyboard.press('Escape');

step('hyphens stay hyphens in table rows');
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+End');
await page.keyboard.type('\n\n| a | b |\n| --- | :--: |\n| 1990--2000 | x |\n\nA -- B');
await page.waitForTimeout(100);
assert.match(await editorText(), /\| a \| b \|\n\| --- \| :--: \|\n\| 1990--2000 \| x \|\nA – B/);

step('⌘B, ⌘I, ⌘M; ==marked text==; a table that starts with a separator row');
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('one two three');
await page.evaluate(() => {
  const text = document.querySelector('.cm-line').firstChild;
  const r = document.createRange();
  r.setStart(text, 4);
  r.setEnd(text, 7);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
});
await page.waitForTimeout(100);
await page.keyboard.press('ControlOrMeta+b');
assert.equal(await editorText(), 'one **two** three', '⌘B');
await page.keyboard.press('ControlOrMeta+i');
assert.equal(await editorText(), 'one ***two*** three', '⌘I adds italic to bold');
await page.keyboard.press('ControlOrMeta+m');
assert.equal(await editorText(), 'one ***==two==*** three', '⌘M');
await page.keyboard.press('ControlOrMeta+b');
assert.equal(await editorText(), 'one *==two==* three', '⌘B again removes bold only');
await page.waitForTimeout(300);
await menu('format-mark');
await page.waitForTimeout(100);
assert.equal(await editorText(), 'one *two* three', 'Format › Mark removes the mark');
await menu('format-mark');
await page.waitForTimeout(100);
await page.keyboard.press('ControlOrMeta+End');
await page.keyboard.type('\n\n|:--|:--|\n| x | y |\n\nEnd.');
await page.waitForTimeout(200);
assert.equal(await page.locator('.cm-md-table').count(), 2, 'the editor sees a table that starts with a separator row');
const markedBackground = await page.evaluate(() => [...document.querySelectorAll('.cm-content span')].filter((e) => e.textContent === 'two').map((e) => getComputedStyle(e).backgroundColor));
assert.ok(markedBackground.some((b) => b.includes('255, 214, 102')), `marked text is highlighted in the editor (${markedBackground})`);
await page.waitForTimeout(1200);
await page.getByRole('tab', { name: 'Preview', exact: true }).click();
await page.waitForFunction(() => {
  const d = document.querySelector('.preview-frame.visible')?.contentDocument;
  return d?.querySelector('mark') && d.querySelector('table');
}, null, { timeout: 30000 });
const rendered = await page.evaluate(() => {
  const d = document.querySelector('.preview-frame.visible').contentDocument;
  return { mark: d.querySelector('mark').textContent, em: !!d.querySelector('em mark, mark em'), thead: d.querySelectorAll('thead').length, cells: [...d.querySelectorAll('td')].map((c) => c.textContent) };
});
assert.deepEqual(rendered, { mark: 'two', em: true, thead: 0, cells: ['x', 'y'] });
await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
await page.waitForTimeout(1200);
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.locator('.doc-tab.active', { hasText: 'main.md' }).waitFor();
await rm(occDoc);

step('+++ starts a new page, in any theme');
await mkdir(join(library, 'Themes', 'Bare'), { recursive: true });
await writeFile(join(library, 'Themes', 'Bare', 'theme.css'), '@page { size: letter; margin: 1in; }\n');
const breakDoc = join(library, 'Collections/Examples/Feature Tour/breaks.md');
await writeFile(breakDoc, '---\ntheme: Bare\n---\n\nPage one.\n+++\nPage two.\n\n```\n+++\n```\n');
await page.locator('.tree-row', { hasText: /^breaks\.md$/ }).click();
await page.locator('.cm-content', { hasText: 'Page two.' }).waitFor();
await page.getByRole('tab', { name: 'Preview', exact: true }).click();
await page.waitForFunction(() => {
  const d = document.querySelector('.preview-frame.visible')?.contentDocument;
  return d && [...d.querySelectorAll('.pagedjs_page')].some((p) => p.textContent.includes('Page two.'));
}, null, { timeout: 30000 });
const pagesOfBreaks = await page.evaluate(() => [...document.querySelector('.preview-frame.visible').contentDocument.querySelectorAll('.pagedjs_page')].map((p) => p.querySelector('.pagedjs_page_content').innerText.replace(/\s+/g, ' ').trim()));
assert.deepEqual(pagesOfBreaks, ['Page one.', 'Page two. +++'], `pages: ${JSON.stringify(pagesOfBreaks)}`);
await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
await rm(breakDoc);
await rm(join(library, 'Themes', 'Bare'), { recursive: true });
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.locator('.tree-row.active', { hasText: /^main\.md$/ }).waitFor();

step('tables in the editor do not wrap; they scroll sideways as a whole');
const tableDoc = join(library, 'Collections/Examples/Feature Tour/table.md');
const wide = (cells) => `| ${cells.join(' | ')} |`;
await writeFile(
  tableDoc,
  `# Table\n\nBefore the table, a paragraph long enough to wrap onto a second line in the editor column, which shows that prose still wraps.\n\n${wide(['Region', 'First quarter revenue', 'Second quarter revenue', 'Third quarter revenue', 'Fourth quarter revenue', 'Notes about the year'])}\n${wide(Array(6).fill('---'))}\n${wide(['North', '1,204', '1,388', '1,410', '1,502', 'Steady growth through the year with a strong finish'])}\n${wide(['South', '980', '1,020', '1,100', '1,150', 'New office opened in the spring'])}\n\nAfter the table.\n`,
);
await page.locator('.tree-row', { hasText: /^table\.md$/ }).click();
await page.locator('.cm-md-table').first().waitFor();
await page.waitForTimeout(300);
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cm-md-table')].map((r) => ({
      text: r.textContent.slice(0, 12),
      h: Math.round(r.getBoundingClientRect().height),
      sw: r.scrollWidth,
      cw: r.clientWidth,
      left: Math.round(r.scrollLeft),
    })),
  );
let tableRows = await rows();
assert.equal(tableRows.length, 4, 'four table lines');
const lineHeight = await page.evaluate(() => Math.round(parseFloat(getComputedStyle(document.querySelector('.cm-content')).lineHeight)));
for (const r of tableRows.slice(0, 3)) assert.ok(r.h <= lineHeight + 1, `row "${r.text}" is one line (${r.h}px)`);
assert.ok(
  tableRows.every((r) => r.sw > r.cw),
  `rows are clipped at the column edge (${JSON.stringify(tableRows)})`,
);
assert.ok(Math.max(...tableRows.map((r) => r.sw)) - Math.min(...tableRows.map((r) => r.sw)) <= 2, `rows scroll the same distance (${tableRows.map((r) => r.sw)})`);
const mutations = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const o = new MutationObserver((records) => (n += records.length));
      o.observe(document.querySelector('.cm-content'), { subtree: true, attributes: true, childList: true, characterData: true });
      setTimeout(() => (o.disconnect(), resolve(n)), 500);
    }),
);
assert.equal(mutations, 0, 'the editor is idle (no update loop)');
const paragraphHeight = await page.locator('.cm-line', { hasText: 'Before the table' }).evaluate((l) => l.getBoundingClientRect().height);
assert.ok(paragraphHeight > lineHeight * 1.5, 'prose still wraps');
// Scrolling one row scrolls the whole table.
await page
  .locator('.cm-md-table')
  .nth(2)
  .evaluate((r) => (r.scrollLeft = 200));
await page.waitForTimeout(200);
tableRows = await rows();
assert.deepEqual(
  tableRows.map((r) => r.left),
  [200, 200, 200, 200],
  'rows stay aligned',
);
// The table follows the cursor.
await page
  .locator('.cm-md-table')
  .nth(3)
  .evaluate((r) => (r.scrollLeft = 0));
await page.waitForTimeout(200);
await page.locator('.cm-line', { hasText: 'After the table' }).click();
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('End');
await page.waitForTimeout(300);
tableRows = await rows();
assert.ok(tableRows[3].left > 0 && new Set(tableRows.map((r) => r.left)).size === 1, `table scrolled to the cursor (${tableRows.map((r) => r.left)})`);
const cursorInside = await page.evaluate(() => {
  const c = document.querySelector('.cm-cursor').getBoundingClientRect();
  // Two lines up from "After the table." is the last row (past the blank line).
  const row = document.querySelectorAll('.cm-md-table')[3].getBoundingClientRect();
  return {
    ok: c.left >= row.left && c.right <= row.right + 2 && c.top >= row.top - 2 && c.bottom <= row.bottom + 2,
    c: [c.left, c.right, c.top, c.bottom].map(Math.round),
    row: [row.left, row.right, row.top, row.bottom].map(Math.round),
  };
});
assert.ok(cursorInside.ok, `the cursor is drawn inside the visible part of the row (${JSON.stringify(cursorInside)})`);
await shot('02b-table');
await page.keyboard.type(' (more)');
await page.waitForTimeout(200);
assert.match(await readFile(tableDoc, 'utf8').catch(() => ''), /./);
await rm(tableDoc);
await page
  .locator('.tree-row', { hasText: /^main\.md$/ })
  .first()
  .click();
await page.locator('.tree-row.active', { hasText: /^main\.md$/ }).waitFor();

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
await page.getByRole('tab', { name: 'Preview', exact: true }).click();
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
await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
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
await page.getByRole('tab', { name: 'Preview', exact: true }).click();
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
await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
// Let the edit's autosave finish before the file is removed under the app.
await page.locator('.save-state:not(.dirty)').waitFor();
await rm(editDoc);
await rm(partDoc);
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.locator('.tree-row.active', { hasText: /^main\.md$/ }).waitFor();

step('new collection from the + menu');
await app.evaluate(() => (globalThis.pickLabel = 'New Collection…'));
await page.locator('.sidebar-titlebar .icon-button').click();
await page.locator('.modal h2', { hasText: 'New Collection' }).waitFor();
await page.locator('.modal input[type=text]').fill('Reports');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.locator('.sidebar-tree .tree-row', { hasText: /^Reports$/ }).waitFor();
assert.ok(existsSync(join(library, 'Collections', 'Reports')), 'collection folder created');

step('Finder tag dots from the context menu');
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().waitFor();
for (const color of ['Red', 'Blue']) {
  await app.evaluate((_, c) => (globalThis.pickLabel = c), color);
  await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click({ button: 'right' });
  await page.waitForTimeout(300);
}
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().locator('.tag-dots[aria-label="Tags: Red, Blue"]').waitFor();
const xattrFile = JSON.parse(await readFile(join(tmp, 'userData', 'xattrs.json'), 'utf8'));
assert.equal(Object.keys(xattrFile).filter((p) => p.endsWith('/Feature Tour/main.md')).length, 1, 'tags stored for main.md');
await shot('06-tags');

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
assert.equal(await page.locator('.toolbar .toolbar-button', { hasText: 'PDF' }).count(), 0, 'no PDF button in the top bar');
await page.locator('button[title^="History"]').click();
// The panel runs the full height, its tabs in its own see-through top bar, content scrolling under it.
const panelLayout = await page.evaluate(() => {
  const panel = document.querySelector('.right-panel').getBoundingClientRect();
  const top = document.querySelector('.panel-top');
  const scroller = document.querySelector('.history-panel');
  return {
    panelTop: panel.top,
    panelBottom: Math.round(panel.bottom),
    windowHeight: window.innerHeight,
    toolbarToggles: document.querySelectorAll('.toolbar .panel-toggles').length,
    tabs: [...top.querySelectorAll('[role=tab]')].map((t) => `${t.getAttribute('aria-label')}:${t.getAttribute('aria-selected')}`),
    topBackground: getComputedStyle(top).backgroundColor,
    scrollerTop: scroller.getBoundingClientRect().top,
    scrollerPadding: getComputedStyle(scroller).paddingTop,
    toolbarRight: Math.round(document.querySelector('.toolbar').getBoundingClientRect().right),
    panelLeft: Math.round(panel.left),
  };
});
assert.equal(panelLayout.panelTop, 0, 'panel starts at the top of the window');
assert.equal(panelLayout.panelBottom, panelLayout.windowHeight, 'and ends at the bottom');
assert.equal(panelLayout.toolbarToggles, 0, 'the toggles left the top bar');
assert.deepEqual(panelLayout.tabs, ['Assistant:false', 'Insights:false', 'History:true']);
assert.match(panelLayout.topBackground, /rgba\(30, 31, 33, 0\.9\)/);
assert.equal(panelLayout.scrollerTop, 0, 'panel content starts under its top bar');
assert.equal(panelLayout.scrollerPadding, '52px');
assert.ok(panelLayout.toolbarRight <= panelLayout.panelLeft, 'the top bar stops at the panel');
await shot('07b-panel');
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
await page.getByRole('tab', { name: 'Preview', exact: true }).click();
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
await shot('06-template-preview');

step('template from a project, then a project from that template');
await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
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
await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
await page.locator('.statusbar .status-button', { hasText: 'Theme:' }).click();
await page.locator('.theme-popover .popover-item[title^="Edit the library theme"]', { hasText: 'Modern' }).click();
await page.locator('.cm-code').waitFor();
await page.locator('.status-file', { hasText: 'Theme “Modern”' }).waitFor();
await shot('07-theme-css');
await page.getByRole('tab', { name: 'Preview', exact: true }).click();
await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(500);
await shot('08-theme-preview');

step('theme export and import, with images');
const themePackage = join(tmp, 'out', 'Modern.mdtheme');
const brandImage = join(tmp, 'brand.svg');
await writeFile(brandImage, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
await app.evaluate(({ dialog }, p) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
}, brandImage);
await page.getByRole('tab', { name: 'CSS', exact: true }).click();
await page.locator('.statusbar .status-button', { hasText: /^Theme/ }).click();
await app.evaluate(() => (globalThis.pickLabel = 'Add Images…'));
await page.locator('.theme-popover .popover-item[title^="Edit the library theme"]', { hasText: 'Modern' }).click({ button: 'right' });
await page.locator('.toast', { hasText: 'Added images/brand.svg to “Modern”' }).waitFor();
assert.ok(existsSync(join(library, 'Themes', 'Modern', 'images', 'brand.svg')), 'image copied into the theme');
// A component stylesheet that also uses an image from elsewhere in the library.
await mkdir(join(library, 'Themes', 'Modern', 'includes'), { recursive: true });
await writeFile(join(library, 'Themes', 'Modern', 'includes', 'brandmark.css'), '.brandmark { background: url("images/brand.svg"), url("../../Collections/Examples/Feature Tour/assets/diagram.svg"); }\n');
await app.evaluate(({ dialog }, p) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
}, themePackage);
await page.locator('.statusbar .status-button', { hasText: /^Theme/ }).click();
await app.evaluate(() => (globalThis.pickLabel = 'Export…'));
await page.locator('.theme-popover .popover-item[title^="Edit the library theme"]', { hasText: 'Modern' }).click({ button: 'right' });
const exportToast = page.locator('.toast', { hasText: 'Exported Modern.mdtheme' });
await exportToast.waitFor();
const exportText = await exportToast.textContent();
assert.match(exportText, /Images included: 2\./);
assert.match(exportText, /Copied in from the library: \.\.\/\.\.\/Collections\/Examples\/Feature Tour\/assets\/diagram\.svg/);
assert.ok(existsSync(themePackage), 'theme package written');
const { unzipSync, strFromU8 } = await import('fflate');
const packaged = unzipSync(new Uint8Array(await readFile(themePackage)));
assert.ok(packaged['images/brand.svg'] && packaged['images/diagram.svg'], `images packaged (${Object.keys(packaged)})`);
assert.equal(strFromU8(packaged['includes/brandmark.css']).trim(), '.brandmark { background: url("images/brand.svg"), url("images/diagram.svg"); }');
await page.locator('.statusbar .status-button', { hasText: /^Theme/ }).click();
await page.locator('.theme-popover .popover-item', { hasText: 'Import theme…' }).click();
await page.locator('.toast', { hasText: 'Imported theme “Modern 2”. It includes 2 images.' }).waitFor();
assert.ok(existsSync(join(library, 'Themes', 'Modern 2', 'theme.css')), 'imported theme folder');
assert.ok(existsSync(join(library, 'Themes', 'Modern 2', 'images', 'diagram.svg')), 'imported theme images');

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
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
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
