// End-to-end check of PDF accessibility: exports a fixture covering every block type and the
// Feature Tour, inserts PDF pages through the UI (page picker, export arrangement), then checks
// the tag structure and, when veraPDF is available, validates against PDF/UA-1 (ISO 14289-1)
// machine-checkable rules.
//
// Linux: xvfb-run -a node apps/desktop/e2e/pdf.mjs   macOS: node apps/desktop/e2e/pdf.mjs
// veraPDF: set VERAPDF to the command, e.g. VERAPDF=verapdf or
//          VERAPDF="java -cp /path/to/verapdf/lib/* org.verapdf.apps.GreenfieldCliWrapper"
import { _electron as electron } from 'playwright';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, StandardFonts } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const tmp = await mkdtemp(join(tmpdir(), 'mde-pdf-'));
const library = join(tmp, 'Library');
const electronBin = (await import('electron')).default;
const step = (name) => console.log(`• ${name}`);

const app = await electron.launch({
  executablePath: electronBin,
  args: [appDir, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, MDE_LIBRARY: library, MDE_USER_DATA: join(tmp, 'userData') },
});
const page = await app.firstWindow();
await page.locator('.sidebar-tree').waitFor();
const invoke = async (method, args) => {
  const r = await page.evaluate(([m, a]) => window.mdeHost.invoke(m, a), [method, args]);
  assert.equal(r.ok, true, r.message);
  return r.value;
};

step('export the fixture and the Feature Tour');
await invoke('library.createCollection', ['Tests']);
const project = await invoke('library.createProject', [{ collection: 'Tests', name: 'Accessibility' }]);
await copyFile(join(here, 'fixtures', 'accessibility.md'), join(project, 'main.md'));
await writeFile(join(project, 'flow.mmd'), 'flowchart LR\n  A[Request] --> B{Valid?}\n  B -->|Yes| C[Process]\n  B -->|No| D[Reject]\n');
await writeFile(join(project, 'red.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#c00"/></svg>');
const fixturePdf = join(tmp, 'fixture.pdf');
const modernPdf = join(tmp, 'fixture-modern.pdf');
const tourPdf = join(tmp, 'tour.pdf');
const fixtureRender = await invoke('render.document', [{ docPath: join(project, 'main.md') }]);
assert.deepEqual(fixtureRender.warnings.filter((w) => w.kind === 'accessibility'), [], 'fixture has no accessibility warnings');
await invoke('exports.pdf', [{ docPath: join(project, 'main.md'), outPath: fixturePdf }]);
const fixture = await readFile(join(project, 'main.md'), 'utf8');
await writeFile(join(project, 'modern.md'), fixture.replace('---\ntitle:', '---\ntheme: Modern\ntitle:'));
await invoke('exports.pdf', [{ docPath: join(project, 'modern.md'), outPath: modernPdf }]);
const tourDoc = join(library, 'Collections/Examples/Feature Tour/main.md');
const tourClean = !(await invoke('render.document', [{ docPath: tourDoc }])).warnings.some((w) => w.kind === 'accessibility');
await invoke('exports.pdf', [{ docPath: tourDoc, outPath: tourPdf }]);

step('diagrams in the preview use the theme font');
const shots = process.env.MDE_SHOTS ?? join(appDir, 'test-results');
await mkdir(shots, { recursive: true });
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
await page.getByText('Tests', { exact: true }).click();
await page.getByText('Accessibility', { exact: true }).click();
await page.locator('.tree-row', { hasText: /^main\.md$/ }).first().click();
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.page-count')?.textContent ?? ''), null, { timeout: 60000 });
const fonts = await page.evaluate(async () => {
  const doc = document.querySelector('iframe.preview-frame.visible').contentDocument;
  await doc.fonts.ready;
  const svgs = [...doc.querySelectorAll('.mde-mermaid > svg')];
  const para = doc.querySelector('.pagedjs_page_content p');
  const textFont = (svg) => {
    const t = svg.querySelector('text');
    return t ? getComputedStyle(t).fontFamily : null;
  };
  return { count: svgs.length, labels: svgs.map((s) => s.getAttribute('aria-label')), paragraph: getComputedStyle(para).fontFamily, diagrams: svgs.map(textFont), errors: doc.querySelectorAll('.mde-missing').length };
});
console.log(`  paragraph: ${fonts.paragraph}\n  diagrams: ${fonts.diagrams.join(' | ')}`);
console.log(`  diagram alt text: ${fonts.labels.join(' | ')}`);
assert.equal(fonts.count, 2, 'two diagrams drawn');
assert.equal(fonts.errors, 0, 'no diagram errors');
for (const f of fonts.diagrams) assert.equal(f, fonts.paragraph, 'diagram text uses the paragraph font');
await page.locator('.preview-frame.visible').evaluate((f) => f.contentDocument.querySelector('.mde-diagram')?.scrollIntoView());
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, '30-diagrams.png') });

step('accessibility warnings before export');
await writeFile(join(project, 'warn.md'), '# Title\n\n### Skipped a level\n\n![](red.svg)\n\n/red.svg\n');
const warned = await invoke('render.document', [{ docPath: join(project, 'warn.md') }]);
const messages = warned.warnings.filter((w) => w.kind === 'accessibility').map((w) => w.message);
assert.equal(messages.length, 3, messages.join('\n'));
assert.match(messages[0], /skips from level 1 to 3/);

step('PDF pages: insert into a document, choose pages, arrange the export');
// Native menus and dialogs cannot be driven by Playwright: choose menu items by label, answer
// confirmations with OK and save dialogs with a fixed path.
await app.evaluate(({ Menu, dialog }) => {
  Menu.prototype.popup = function (opts) {
    const item = this.items.find((i) => i.label === globalThis.pickLabel && i.enabled);
    globalThis.pickLabel = null;
    item?.click();
    setTimeout(() => opts?.callback?.(), 0);
  };
  dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.savePath });
});
const pick = (label) => app.evaluate((_, l) => (globalThis.pickLabel = l), label);
const insertsProject = await invoke('library.createProject', [{ collection: 'Tests', name: 'Inserts' }]);
// A source made by the app (tagged, fonts embedded) and a form made without embedded fonts.
await writeFile(join(insertsProject, 'source.md'), '---\ntitle: Source\n---\n\n# Source\n\n' + Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the source, long enough to fill most of a line.`).join('\n\n') + '\n');
await invoke('exports.pdf', [{ docPath: join(insertsProject, 'source.md'), outPath: join(insertsProject, 'source.pdf') }]);
const sourcePages = (await PDFDocument.load(await readFile(join(insertsProject, 'source.pdf')))).getPageCount();
assert.ok(sourcePages >= 2, 'source has at least two pages');
const form = await PDFDocument.create();
const helvetica = await form.embedFont(StandardFonts.Helvetica);
for (const label of ['Form page one', 'Form page two']) form.addPage([500, 700]).drawText(label, { x: 50, y: 600, size: 20, font: helvetica });
const field = form.getForm().createTextField('name');
field.setText('Jane Doe');
field.addToPage(form.getPage(0), { x: 50, y: 500, width: 200, height: 24 });
await writeFile(join(insertsProject, 'form.pdf'), await form.save());
await writeFile(join(insertsProject, 'main.md'), '---\ntitle: Proposal\n---\n\n# Proposal\n\nBefore the source.\n\nAfter the source.\n');

await page.getByText('Inserts', { exact: true }).click();
await page.locator('.tree-row', { hasText: /^main\.md$/ }).last().click();
await page.getByRole('tab', { name: 'Markdown' }).click();
await page.locator('.cm-line', { hasText: 'Before the source.' }).click();
await page.keyboard.press('End');
await pick('Insert into Document');
await page.locator('.tree-row', { hasText: /^source\.pdf$/ }).click({ button: 'right' });
await page.locator('.cm-line', { hasText: '/source.pdf "source"' }).waitFor();

await pick('Choose PDF Pages…');
await page.locator('.cm-line', { hasText: '/source.pdf' }).click({ button: 'right' });
await page.locator('.page-picker').waitFor();
await page.waitForFunction((n) => document.querySelectorAll('.picker-grid img').length === n, sourcePages, { timeout: 30000 });
await page.screenshot({ path: join(shots, '31-page-picker.png') });
await page.getByRole('button', { name: 'Clear', exact: true }).click();
await page.locator('.picker-page').nth(1).click();
await page.locator('.picker-page').nth(0).click();
await page.getByRole('button', { name: 'Use 2 pages' }).click();
await page.locator('.cm-line', { hasText: '/source.pdf#pages=2,1 "source"' }).waitFor();
const lines = await page.locator('.cm-line').allTextContents();
const at = lines.indexOf('Before the source.');
assert.deepEqual(lines.slice(at, at + 5), ['Before the source.', '', '/source.pdf#pages=2,1 "source"', '', 'After the source.'], 'block line between the paragraphs');

step('inserted pages in the preview');
await page.getByRole('tab', { name: 'Preview' }).click();
await page.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.page-count')?.textContent ?? ''), null, { timeout: 60000 });
const drawn = await page.evaluate(() => {
  const doc = document.querySelector('iframe.preview-frame.visible').contentDocument;
  return [...doc.querySelectorAll('.mde-pdf-page')].map((el) => ({ img: !!el.querySelector('img'), label: el.getAttribute('aria-label') }));
});
assert.deepEqual(drawn, [{ img: true, label: 'source, page 1 of 2' }, { img: true, label: 'source, page 2 of 2' }]);
await page.locator('.preview-frame.visible').evaluate((f) => f.contentDocument.querySelector('.mde-pdf-page')?.scrollIntoView());
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, '32-inserted-preview.png') });

step('export arrangement: a form before the document');
const arrangedPdf = join(tmp, 'arranged.pdf');
await app.evaluate((_, p) => (globalThis.savePath = p), arrangedPdf);
await page.getByTitle('Export PDF (⇧⌘E)').click();
await page.locator('.export-dialog').waitFor();
await page.waitForFunction(() => document.querySelectorAll('.arrange-add option').length > 1);
await page.locator('.arrange-add select').selectOption('form.pdf');
await page.getByRole('button', { name: 'Move form.pdf up' }).click();
await page.locator('.arrange-row', { hasText: 'form.pdf' }).getByRole('button', { name: 'Pages…' }).click();
await page.waitForFunction(() => document.querySelectorAll('.picker-grid img').length === 2, null, { timeout: 30000 });
await page.getByRole('button', { name: 'Clear', exact: true }).click();
await page.locator('.picker-page').nth(0).click();
await page.getByRole('button', { name: 'Use 1 page' }).click();
await page.getByLabel('Description of form.pdf').fill('Signed form');
await page.locator('.arrange-row', { hasText: 'Before form.pdf' }).waitFor();
await page.screenshot({ path: join(shots, '33-export-arrangement.png') });
await page.getByRole('button', { name: 'Export…' }).click();
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Exported arranged\.pdf/.test(t.textContent)), null, { timeout: 60000 });
const meta = JSON.parse(await readFile(join(insertsProject, '.mdeditor', 'project.json'), 'utf8'));
assert.deepEqual(meta.exportArrangements, { 'main.md': [{ kind: 'pdf', path: 'form.pdf', title: 'Signed form', pages: '1' }, { kind: 'document' }] }, 'arrangement saved per document');
const insertsPdf = join(tmp, 'inserts.pdf');
await invoke('exports.pdf', [{ docPath: join(insertsProject, 'main.md'), outPath: insertsPdf, arrangement: [] }]);
await app.close();

/** Structure elements in reading order: [{ type, depth, alt, el }]. */
function structure(doc) {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const roleMap = root.lookupMaybe(PDFName.of('RoleMap'), PDFDict);
  const out = [];
  const visit = (o, depth) => {
    const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
    if (d instanceof PDFArray) return d.asArray().forEach((x) => visit(x, depth));
    if (!(d instanceof PDFDict) || !d.get(PDFName.of('S'))) return;
    const type = d.get(PDFName.of('S')).decodeText();
    const alt = d.get(PDFName.of('Alt'));
    out.push({ type, depth, alt: alt ? alt.decodeText() : null, el: d, mapped: roleMap?.get(PDFName.of(type))?.decodeText() });
    visit(d.get(PDFName.of('K')), depth + 1);
  };
  visit(root.get(PDFName.of('K')), 0);
  return out;
}

async function checkTags(path, { expectClaim }) {
  const doc = await PDFDocument.load(await readFile(path));
  const tags = structure(doc);
  const blocks = tags.filter((t) => !['NonStruct', 'Art', 'Document', 'Span', 'Em', 'Strong', 'Code', 'Link', 'Lbl', 'LBody', 'TR', 'TH', 'TD', 'Caption', 'LI'].includes(t.type)).map((t) => t.type);
  // Every list item is a label plus a body.
  for (const li of tags.filter((t) => t.type === 'LI')) {
    const kids = tags.filter((t) => t.depth === li.depth + 1 && tags.indexOf(t) > tags.indexOf(li)).slice(0, 2).map((t) => t.type);
    assert.deepEqual(kids, ['Lbl', 'LBody'], 'LI holds Lbl and LBody');
  }
  for (const f of tags.filter((t) => t.type === 'Figure')) assert.ok(f.alt, 'every Figure has alt text');
  for (const t of tags.filter((t) => ['Em', 'Strong'].includes(t.type))) assert.equal(t.mapped, 'Span', `${t.type} is role-mapped`);
  for (const p of doc.getPages()) {
    for (const a of p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []) {
      const annot = doc.context.lookup(a, PDFDict);
      if (annot.get(PDFName.of('Subtype')) === PDFName.of('Link')) assert.ok(annot.get(PDFName.of('Contents')), 'link has a description');
    }
  }
  const xmp = new TextDecoder().decode(doc.context.lookup(doc.catalog.get(PDFName.of('Metadata')), PDFRawStream).getContents());
  assert.equal(xmp.includes('<pdfuaid:part>1</pdfuaid:part>'), expectClaim, 'PDF/UA identification');
  assert.ok(doc.catalog.get(PDFName.of('Lang')), 'document language');
  return blocks;
}

step('tags: headings, paragraphs, lists, quotes, tables and figures');
const blocks = await checkTags(fixturePdf, { expectClaim: true });
console.log(`  ${blocks.join(' ')}`);
assert.deepEqual(blocks.slice(0, 11), ['H1', 'P', 'H2', 'L', 'L', 'L', 'L', 'P', 'P', 'H2', 'BlockQuote']);
for (const t of ['H3', 'Table', 'H4']) assert.ok(blocks.includes(t), `has ${t}`);
// Two images and two diagrams, each one Figure with alt text.
const figures = structure(await PDFDocument.load(await readFile(fixturePdf))).filter((t) => t.type === 'Figure').map((t) => t.alt);
console.log(`  figures: ${figures.join(' | ')}`);
assert.deepEqual(figures, ['A red square', 'A red square, as a content block', 'Project schedule. Design takes two weeks from March 1, then building takes three weeks.', 'How a request is handled']);
await checkTags(tourPdf, { expectClaim: tourClean });
await checkTags(modernPdf, { expectClaim: true });

step('inserted and arranged pages');
await checkTags(insertsPdf, { expectClaim: true });
// The form's fonts are not embedded, so the arranged export is not marked PDF/UA.
await checkTags(arrangedPdf, { expectClaim: false });
const arranged = await PDFDocument.load(await readFile(arrangedPdf));
const inserted = await PDFDocument.load(await readFile(insertsPdf));
assert.equal(arranged.getPageCount(), inserted.getPageCount() + 1, 'one form page added');
assert.deepEqual(arranged.getPage(0).getSize(), { width: 500, height: 700 }, 'form page keeps its size');
assert.equal(arranged.getPage(0).node.get(PDFName.of('Annots')), undefined, 'form fields are flattened');
const xobjects = arranged.getPage(0).node.Resources().lookupMaybe(PDFName.of('XObject'), PDFDict);
assert.ok(xobjects?.keys().some((k) => k.decodeText().startsWith('MdeFlat')), 'field appearance drawn into the page');
const arrangedFigures = structure(arranged).filter((t) => t.type === 'Figure').map((t) => t.alt);
console.log(`  figures: ${arrangedFigures.join(' | ')}`);
assert.deepEqual(arrangedFigures, ['Signed form, page 1 of 1', 'source, page 1 of 2', 'source, page 2 of 2']);

const vera = process.env.VERAPDF;
if (vera) {
  step('veraPDF: PDF/UA-1');
  for (const pdf of [fixturePdf, modernPdf, tourPdf, insertsPdf]) {
    const json = JSON.parse(execSync(`${vera} -f ua1 --format json "${pdf}"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
    const results = JSON.stringify(json).match(/"compliant":(true|false)/g) ?? [];
    const failed = [];
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === 'object') {
        if (o.ruleSummaries) for (const r of o.ruleSummaries) failed.push(`${r.clause}-${r.testNumber}: ${r.description}`);
        Object.values(o).forEach(walk);
      }
    };
    walk(json);
    console.log(`  ${pdf.split('/').pop()}: ${results.join(', ')}${failed.length ? `\n    ${failed.join('\n    ')}` : ''}`);
    assert.deepEqual(failed, [], `${pdf} passes PDF/UA-1`);
  }
} else console.log('  (set VERAPDF to also validate with veraPDF)');
console.log('OK');
