// The web app in Chromium, at phone and tablet sizes, against a stand-in Dropbox (mockDropbox.mjs)
// and a stand-in Google Drive (mockDrive.mjs): setup and sign-in, the library seeded in the cloud,
// editing and saving, changes made elsewhere, working offline, a conflict copy, AI keys kept with the
// account, preview images through the service worker, print, web page export, and the layout.
// Run after `npm run build:web`: node apps/web/e2e/web.mjs   (MDE_SHOTS=dir for screenshots)
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from '../serve.mjs';
import { mockDropbox } from './mockDropbox.mjs';
import { mockDrive } from './mockDrive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const shots = process.env.MDE_SHOTS ?? join(here, '..', 'test-results');
await mkdir(shots, { recursive: true });
const step = (s) => console.log(`• ${s}`);
const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

const dropbox = mockDropbox();
const drive = mockDrive();
const dbPort = await dropbox.listen();
const drPort = await drive.listen();
const db = `http://127.0.0.1:${dbPort}`;
const dr = `http://127.0.0.1:${drPort}`;
const configPath = join(dist, 'config.json');
const originalConfig = await readFile(configPath, 'utf8');
await writeFile(
  configPath,
  JSON.stringify({ dropboxAppKey: 'test-app-key', googleClientId: 'test-client-id', dropboxEndpoints: { auth: db, api: db, content: db }, driveEndpoints: { auth: dr, api: `${dr}/drive/v3`, upload: `${dr}/upload/drive/v3` } }),
);
const appServer = await serve(dist, 0);
const app = `http://127.0.0.1:${appServer.address().port}/`;
const browser = await chromium.launch({ executablePath });
const errors = [];

const remoteFiles = async () => (await fetch(`${db}/__test/files`)).json();
/** Text at the end of the document in the editor (CodeMirror puts only the lines on screen in the page). */
const editorHas = (p, text) =>
  p.waitForFunction(
    (t) => {
      const scroller = document.querySelector('.cm-scroller');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      return document.querySelector('.cm-content')?.textContent.includes(t);
    },
    text,
    { timeout: 20000 },
  );
const until = async (check, what, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

try {
  // ---------------- Dropbox, on a phone ----------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await phone.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(app);

  step('setup: Dropbox, sign in (PKCE), make the library folder');
  await page.getByRole('button', { name: 'Dropbox' }).click();
  assert.equal(await page.locator('.folio-setup input').inputValue(), 'test-app-key', 'app key from config.json');
  await page.screenshot({ path: join(shots, 'web-01-setup.png') });
  await page.getByRole('button', { name: 'Sign in with Dropbox' }).click();
  await page.getByRole('button', { name: 'Make Folder' }).waitFor();
  await page.screenshot({ path: join(shots, 'web-02-folders.png') });
  await page.getByRole('button', { name: 'Make Folder' }).click();

  step('a new library is set up in Dropbox; the phone layout keeps the library in a drawer');
  await page.locator('.toolbar').waitFor();
  await until(async () => (await remoteFiles())['/Folio Dome Library/Collections/Examples/Feature Tour/main.md'], 'seeded files uploaded');
  assert.equal(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right <= 0), true, 'library hidden off screen');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
  await page.screenshot({ path: join(shots, 'web-03-phone-library.png') });
  await page.getByText('Examples', { exact: true }).click();
  await page.getByText('Feature Tour', { exact: true }).click();
  await page.locator('.tree-row', { hasText: /^main\.md$/ }).click();
  await page.locator('.cm-content').waitFor();
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
  await page.screenshot({ path: join(shots, 'web-04-phone-editor.png') });

  step('typing is saved to Dropbox');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\nWritten on the phone.');
  await until(async () => /Written on the phone\./.test((await remoteFiles())['/Folio Dome Library/Collections/Examples/Feature Tour/main.md'] ?? ''), 'edit uploaded');
  await page.locator('.sync-state', { hasText: 'Saved to Dropbox' }).waitFor();

  step('a change made elsewhere (the Mac) shows up');
  const mainPath = '/Folio Dome Library/Collections/Examples/Feature Tour/main.md';
  const fromMac = (await remoteFiles())[mainPath].replace('Written on the phone.', 'Changed on the Mac.');
  await fetch(`${db}/__test/write`, { method: 'POST', body: JSON.stringify({ path: mainPath, text: fromMac }) });
  await page.evaluate(() => window.__folioSync.poll());
  await editorHas(page, 'Changed on the Mac.');

  step('offline: changes are kept on the device, then sent');
  await phone.setOffline(true);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Typed offline.');
  await page.locator('.sync-state.offline').waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shots, 'web-05-offline.png') });
  await phone.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(async () => /Typed offline\./.test((await remoteFiles())[mainPath] ?? ''), 'offline edit sent');

  step('a file changed in both places: this device’s version is kept as a copy');
  await page.locator('.sync-state', { hasText: 'Saved to Dropbox' }).waitFor();
  await fetch(`${db}/__test/write`, { method: 'POST', body: JSON.stringify({ path: mainPath, text: `${(await remoteFiles())[mainPath]}\nMac again.` }) });
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Phone again.');
  await until(async () => Object.keys(await remoteFiles()).some((p) => /main \(conflicted copy\)\.md$/.test(p)), 'conflict copy');
  const files = await remoteFiles();
  assert.match(files['/Folio Dome Library/Collections/Examples/Feature Tour/main (conflicted copy).md'], /Phone again\./);
  assert.match(files[mainPath], /Mac again\./);
  await page.locator('.toast', { hasText: 'was changed in Dropbox while it was being edited here' }).waitFor();

  step('the preview shows the theme’s images (service worker) on a phone-sized page');
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.waitForFunction(() => /\/ \d+/.test(document.querySelector('.page-count:not(.rendering) .page-total')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const doc = document.querySelector('iframe.preview-frame.visible')?.contentDocument;
      const imgs = [...(doc?.querySelectorAll('img') ?? [])];
      return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    },
    null,
    { timeout: 30000 },
  );
  await page.screenshot({ path: join(shots, 'web-06-phone-preview.png') });

  step('Export PDF: laid out and offered to the browser’s print dialog');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('.folio-menu-item', { hasText: 'File' }).click();
  await page.locator('.folio-menu-item', { hasText: 'Export PDF…' }).click();
  await page.locator('.modal h2', { hasText: 'Export PDF' }).waitFor();
  await page.getByRole('button', { name: 'Export…' }).click();
  const ok = page.locator('.modal').getByRole('button', { name: 'Export', exact: true });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  const printButton = page.getByRole('button', { name: 'Print or Save as PDF…' });
  await printButton.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.folio-print-layer button.primary')?.disabled, null, { timeout: 60000 }).catch(async (e) => {
    console.log('print status:', await page.locator('.folio-print-status').textContent(), await page.evaluate(() => typeof document.querySelector('.folio-print-frame')?.contentWindow?.__mdeRender));
    await page.screenshot({ path: join(shots, 'web-07-print-failed.png') });
    throw e;
  });
  await page.screenshot({ path: join(shots, 'web-07-print.png') });
  await page.locator('.folio-print-layer').getByRole('button', { name: 'Close' }).click();

  step('AI key: saved with the Dropbox account, outside the library');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('.folio-menu-item', { hasText: 'Folio Dome' }).click();
  await page.locator('.folio-menu-item', { hasText: 'Settings…' }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.locator('input[placeholder="Paste key"]').first().fill('sk-test-123');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await until(async () => (await remoteFiles())['/.folio-dome/ai-keys.json'], 'key file');
  assert.match((await remoteFiles())['/.folio-dome/ai-keys.json'], /sk-test-123/);
  await page.keyboard.press('Escape');

  step('Export Web Page: downloaded');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('.folio-menu-item', { hasText: 'File' }).click();
  await page.locator('.folio-menu-item', { hasText: 'Export Web Page…' }).click();
  assert.match((await download).suggestedFilename(), /\.html$/);

  step('a reload starts from the saved tree and keeps working');
  await page.reload();
  await page.locator('.toolbar').waitFor();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.locator('.tree-row', { hasText: /^main \(conflicted copy\)\.md$/ }).waitFor();
  await page.keyboard.press('Escape');

  step('tablet: library beside the editor when held sideways, in a drawer when upright');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().left === 0 && getComputedStyle(el).position !== 'fixed'), 'sidebar in the layout');
  await page.screenshot({ path: join(shots, 'web-08-tablet-landscape.png') });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).position), 'fixed');
  await page.screenshot({ path: join(shots, 'web-09-tablet-portrait.png') });
  await phone.close();

  // ---------------- Google Drive, on a tablet ----------------
  step('Google Drive: sign in in a pop-up, choose a folder, library set up there');
  const tablet = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const gpage = await tablet.newPage();
  gpage.on('pageerror', (e) => errors.push(String(e)));
  await gpage.goto(app);
  await gpage.getByRole('button', { name: 'Google Drive' }).click();
  const [popup] = await Promise.all([gpage.waitForEvent('popup'), gpage.getByRole('button', { name: 'Sign in with Google' }).click()]);
  await popup.waitForEvent('close', { timeout: 15000 }).catch(() => undefined);
  await gpage.getByRole('button', { name: 'Make Folder' }).click();
  await gpage.locator('.toolbar').waitFor();
  await until(async () => drive.fileText('Folio Dome Library/Collections/Examples/Feature Tour/main.md'), 'seeded in Drive', 60000);
  await gpage.getByText('Examples', { exact: true }).click();
  await gpage.getByText('Feature Tour', { exact: true }).click();
  await gpage.locator('.tree-row', { hasText: /^main\.md$/ }).click();
  await gpage.locator('.cm-content').click();
  await gpage.keyboard.press('ControlOrMeta+End');
  await gpage.keyboard.type('\n\nWritten on the tablet.');
  await until(async () => /Written on the tablet\./.test(drive.fileText('Folio Dome Library/Collections/Examples/Feature Tour/main.md') ?? ''), 'edit in Drive');
  drive.writeText('Folio Dome Library/Collections/Examples/Feature Tour/main.md', drive.fileText('Folio Dome Library/Collections/Examples/Feature Tour/main.md').replace('Written on the tablet.', 'Edited in Drive.'));
  await gpage.evaluate(() => window.__folioSync.poll());
  await editorHas(gpage, 'Edited in Drive.');
  await gpage.screenshot({ path: join(shots, 'web-10-drive-tablet.png') });
  await tablet.close();

  const relevant = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  assert.deepEqual(relevant, [], 'no page errors');
  console.log('Web app: all checks passed.');
} finally {
  await writeFile(configPath, originalConfig);
  await browser.close();
  await appServer.close();
  await dropbox.close();
  await drive.close();
}
