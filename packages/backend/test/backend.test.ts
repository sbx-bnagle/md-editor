import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type { AppEvent } from '@mde/core';
import { createBackend, type Backend, type HostAdapter } from '../src/index';

/** Waits for an idle-timer result instead of guessing how long it takes on a busy machine. */
async function until(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out waiting for the condition.');
    await new Promise((r) => setTimeout(r, 25));
  }
}

let dir: string;
let backend: Backend;
let events: AppEvent[];
let trashed: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mde-test-'));
  const seed = join(dir, 'seed');
  await mkdir(join(seed, 'Themes', 'Classic'), { recursive: true });
  await writeFile(join(seed, 'Themes', 'Classic', 'theme.css'), '@page { @top-center { content: var(--title); } }\nbody { font-family: serif; }');
  await mkdir(join(seed, 'Templates', 'Report', 'sections'), { recursive: true });
  await writeFile(join(seed, 'Templates', 'Report', 'main.md'), '---\ntitle: Report\n---\n# {{title}}\n\n/sections/a.md\n');
  await writeFile(join(seed, 'Templates', 'Report', 'sections', 'a.md'), 'Section A');
  events = [];
  trashed = [];
  const host: HostAdapter = {
    trash: async (p) => {
      trashed.push(p);
      await rm(p, { recursive: true });
    },
    reveal: () => undefined,
    renderPdf: async () => ({ pdf: new TextEncoder().encode('%PDF-fake'), inserts: [] }),
    chooseSavePath: async () => null,
    chooseFolder: async () => null,
    chooseFiles: async () => [],
    emit: (e) => events.push(e),
    secrets: { get: async () => null, set: async () => undefined },
  };
  backend = await createBackend({
    host,
    settingsPath: join(dir, 'settings.json'),
    seedDir: seed,
    version: 'test',
    platform: 'test',
    libraryPath: join(dir, 'Library'),
    history: { idleMs: 50 },
  });
});

afterEach(async () => {
  await backend.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe('library', () => {
  test('seeded library, collections, projects from template and scratch', async () => {
    const api = backend.api;
    const lib = join(dir, 'Library');
    expect((await api.app.state()).libraryPath).toBe(lib);
    await api.library.createCollection('Clients');
    const fromTemplate = await api.library.createProject({ collection: 'Clients', name: 'Acme', template: 'Report' });
    const blank = await api.library.createProject({ collection: 'Clients', name: 'Blank' });
    const tree = await api.library.tree();
    expect(tree.collections.map((c) => [c.name, c.projects.map((p) => p.name)])).toEqual([['Clients', ['Acme', 'Blank']]]);
    expect(tree.templates.map((t) => t.name)).toEqual(['Report']);
    expect(tree.themes.map((t) => t.name)).toEqual(['Classic']);
    expect(await readFile(join(fromTemplate, 'sections', 'a.md'), 'utf8')).toBe('Section A');
    expect(await readFile(join(blank, 'main.md'), 'utf8')).toContain('title: Blank');
    const details = await api.project.details(fromTemplate);
    expect(details.meta.kind).toBe('project');
    expect(details.files.map((f) => f.name)).toEqual(['sections', 'main.md']);
    await expect(api.library.createProject({ collection: 'Clients', name: 'Acme' })).rejects.toThrow(/already exists/);
    await expect(api.files.readText('/etc/hosts')).rejects.toThrow(/outside the library/);
    await expect(api.files.readText(join(lib, '..', 'settings.json'))).rejects.toThrow(/outside the library/);

    const tpl = await api.library.createTemplate({ name: 'From Acme', fromProject: fromTemplate });
    expect((await api.project.details(tpl)).meta.kind).toBe('template');
    await api.library.trash(blank);
    expect(trashed).toEqual([blank]);
    await expect(api.library.trash(join(lib, 'Themes'))).rejects.toThrow(/cannot be moved/);
  });
});

describe('render and export', () => {
  test('renders with project theme, variables, and fork override', async () => {
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'Doc', template: 'Report' });
    const r = await api.render.document({ docPath: join(p, 'main.md') });
    expect(r.title).toBe('Report');
    expect(r.themeName).toBe('Classic');
    expect(r.css).toContain('content: string(mde-var-title);');
    expect(r.html).toContain('Section A');
    expect(r.variables).toMatchObject({ project: 'Doc', collection: 'C', filename: 'main' });

    const fork = await api.themes.fork(p, 'Classic');
    await writeFile(fork.cssPath, 'body { color: red; }');
    const r2 = await api.render.document({ docPath: join(p, 'main.md') });
    expect(r2.css).toContain('body { color: red; }');
    const r3 = await api.render.document({ docPath: join(p, 'main.md'), overrides: { [join(p, 'main.md')]: '---\ntitle: Unsaved\n---\nX' } });
    expect(r3.title).toBe('Unsaved');
  });

  test('zip export with and without history; pdf export writes file and snapshot', async () => {
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'Zipped', template: 'Report' });
    const out1 = join(dir, 'out', 'a.zip');
    await api.exports.zip({ projectPath: p, includeHistory: false, outPath: out1 });
    const files1 = Object.keys(unzipSync(new Uint8Array(await readFile(out1)))).sort();
    expect(files1).toEqual(['Zipped/.mdeditor/project.json', 'Zipped/main.md', 'Zipped/sections/a.md']);
    const out2 = join(dir, 'out', 'b.zip');
    await api.exports.zip({ projectPath: p, includeHistory: true, outPath: out2 });
    const z2 = unzipSync(new Uint8Array(await readFile(out2)));
    expect(Object.keys(z2)).toContain('Zipped/.mdeditor/history.mdh');
    expect(strFromU8(z2['Zipped/main.md'])).toContain('title: Report');

    const pdf = join(dir, 'out', 'doc.pdf');
    expect(await api.exports.pdf({ docPath: join(p, 'main.md'), outPath: pdf })).toEqual({ path: pdf });
    expect((await stat(pdf)).size).toBeGreaterThan(0);
    const list = await api.history.list(p);
    expect(list[0]).toMatchObject({ kind: 'export', name: 'Exported doc.pdf' });
    expect((await api.project.details(p)).meta.lastExport).toBe('main.md');
  });

  test('project PDFs: page counts, import into a folder, arrangement checks', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'Proposal' });
    const src = await PDFDocument.create();
    src.addPage();
    src.addPage();
    await writeFile(join(dir, 'outside.pdf'), await src.save());
    await writeFile(join(p, 'broken.pdf'), 'not a pdf');
    const copied = await api.project.importFiles(p, [join(dir, 'outside.pdf'), join(dir, 'outside.pdf')], 'Inserts');
    expect(copied).toEqual([join(p, 'Inserts', 'outside.pdf'), join(p, 'Inserts', 'outside 2.pdf')]);
    await expect(api.project.importFiles(p, [join(dir, 'outside.pdf')], '../x')).rejects.toThrow(/cannot start with a period/);
    const pdfs = (await api.project.pdfs(p)).sort((a, b) => a.rel.localeCompare(b.rel));
    expect(pdfs.map((x) => [x.rel, x.pages ?? x.error])).toEqual([
      ['broken.pdf', 'the file could not be read as a PDF.'],
      ['Inserts/outside 2.pdf', 2],
      ['Inserts/outside.pdf', 2],
    ]);
    expect(pdfs[1].url).toMatch(/^mde-asset:/);
    // A part that does not exist or asks for a page beyond the file stops the export.
    const docPath = join(p, 'main.md');
    await expect(api.exports.pdf({ docPath, outPath: join(dir, 'a.pdf'), arrangement: [{ kind: 'document' }, { kind: 'pdf', path: 'missing.pdf' }] })).rejects.toThrow(/was not found/);
    await expect(api.exports.pdf({ docPath, outPath: join(dir, 'a.pdf'), arrangement: [{ kind: 'pdf', path: 'Inserts/outside.pdf', pages: '3' }, { kind: 'document' }] })).rejects.toThrow(/beyond the 2 pages/);
  });
});

describe('history', () => {
  test('checkpoints, auto snapshots, diff, restore file and project', async () => {
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'H' });
    const main = join(p, 'main.md');
    expect((await api.history.list(p)).map((s) => s.name)).toEqual(['Created']);

    await api.files.saveDocument({ path: main, text: 'Version one\n' });
    const cp = await api.history.checkpoint(p, 'Draft 1');
    expect(cp).toMatchObject({ kind: 'checkpoint', name: 'Draft 1', changeCount: 1 });

    await api.files.saveDocument({ path: main, text: 'Version two\n' });
    await writeFile(join(p, 'extra.md'), 'new file');
    await api.history.touched(p);
    await until(async () => (await api.history.list(p))[0]?.kind === 'auto');
    const list = await api.history.list(p);
    expect(list[0]).toMatchObject({ kind: 'auto', changeCount: 2 });

    const changes = await api.history.changes(p, list[0].id);
    expect(changes).toEqual([
      { path: 'extra.md', status: 'added', binary: false },
      { path: 'main.md', status: 'modified', binary: false },
    ]);
    const d = await api.history.diff(p, list[0].id, 'main.md', 'previous');
    expect(d.hunks[0].lines.map((l) => [l.type, l.text])).toEqual([
      ['del', 'Version one'],
      ['add', 'Version two'],
    ]);

    await api.history.restoreProject(p, cp!.id);
    expect(await readFile(main, 'utf8')).toBe('Version one\n');
    await expect(stat(join(p, 'extra.md'))).rejects.toThrow();
    const after = await api.history.list(p);
    expect(after[0]).toMatchObject({ kind: 'restore', name: 'Restored “Draft 1”' });
    // Nothing changed since the idle snapshot, so no extra "Before restore" snapshot is stored.
    expect(after[1].id).toBe(list[0].id);

    await api.history.restoreFile(p, list[0].id, 'extra.md');
    expect(await readFile(join(p, 'extra.md'), 'utf8')).toBe('new file');
    // Unchanged project: no new automatic snapshot.
    expect(await backend.api.history.checkpoint(p, '')).toMatchObject({ name: 'Checkpoint' });
  });

  test('sync conflict copies are merged and moved to the Trash', async () => {
    const { encodeBlobRecord, encodeSnapshotRecord, indexPack, sha256Hex } = await import('@mde/core');
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'Synced' });
    const pack = join(p, '.mdeditor', 'history.mdh');
    const base = new Uint8Array(await readFile(pack));
    // This Mac: one more version.
    await api.files.saveDocument({ path: join(p, 'main.md'), text: 'This Mac\n' });
    await api.history.checkpoint(p, 'Here');
    // The other Mac appended its own version to the same starting file; sync kept both.
    const created = indexPack(base).snapshots[0];
    const other = new TextEncoder().encode('Other Mac\n');
    const h = sha256Hex(other);
    const theirs = encodeSnapshotRecord({ id: 'other-1', time: created.time + 1, kind: 'checkpoint', name: 'There', parent: created.id, files: { ...created.files, 'main.md': { h, s: other.length } } });
    const copy = join(p, '.mdeditor', 'history 2.mdh');
    await writeFile(copy, Buffer.concat([base, encodeBlobRecord(h, other), theirs]));

    const list = await api.history.list(p);
    expect(list.map((x) => x.name)).toEqual(['Here', 'There', 'Created']);
    expect(trashed).toEqual([copy]);
    const d = await api.history.diff(p, 'other-1', 'main.md', 'previous');
    expect(d.hunks[0].lines.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['Other Mac']);
    // The merged pack is a normal pack: new versions append to it.
    await api.files.saveDocument({ path: join(p, 'main.md'), text: 'Later\n' });
    expect(await api.history.checkpoint(p, 'Later')).toMatchObject({ name: 'Later' });
    expect((await api.history.list(p)).length).toBe(4);
  });

  test('old automatic versions are pruned', async () => {
    const { HISTORY_MAGIC, encodeBlobRecord, encodeSnapshotRecord, sha256Hex } = await import('@mde/core');
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'Pruned' });
    // A pack with 40 automatic versions from one day 10 days ago, and a checkpoint.
    const day = Date.now() - 10 * 86_400_000;
    const parts: Uint8Array[] = [HISTORY_MAGIC];
    for (let i = 0; i < 40; i++) {
      const c = new TextEncoder().encode(`v${i}\n`);
      const h = sha256Hex(c);
      parts.push(encodeBlobRecord(h, c), encodeSnapshotRecord({ id: `a${i}`, time: day + i * 60_000, kind: i === 5 ? 'checkpoint' : 'auto', files: { 'main.md': { h, s: c.length } } }));
    }
    await writeFile(join(p, '.mdeditor', 'history.mdh'), Buffer.concat(parts));
    await api.files.saveDocument({ path: join(p, 'main.md'), text: 'Now\n' });
    await api.history.touched(p);
    await until(async () => (await api.history.list(p)).length === 4);
    const ids = (await api.history.list(p)).map((x) => x.id).reverse();
    expect(ids.slice(0, 3)).toEqual(['a0', 'a5', 'a39']);
    expect(ids.length).toBe(4);
    const restored = await api.history.diff(p, 'a39', 'main.md', 'current');
    expect(restored.same).toBe(false);
  });

  test('themes and guides have a library-level history', async () => {
    const api = backend.api;
    const theme = join(dir, 'Library', 'Themes', 'Classic', 'theme.css');
    const root = await api.history.rootFor(theme);
    expect(root).toEqual({ path: join(dir, 'Library', 'Themes'), name: 'Themes', kind: 'library' });
    await api.history.checkpoint(root!.path, 'Original');
    await writeFile(theme, 'body { color: red; }');
    const cp = await api.history.checkpoint(root!.path, 'Red');
    expect((await api.history.changes(root!.path, cp!.id)).map((c) => c.path)).toEqual(['Classic/theme.css']);
    await api.history.restoreFile(root!.path, (await api.history.list(root!.path)).find((x) => x.name === 'Original')!.id, 'Classic/theme.css');
    expect(await readFile(theme, 'utf8')).toContain('@top-center');
    const p = await (async () => {
      await api.library.createCollection('C');
      return api.library.createProject({ collection: 'C', name: 'P' });
    })();
    expect(await api.history.rootFor(join(p, 'main.md'))).toMatchObject({ path: p, kind: 'project' });
    expect(await api.history.rootFor(join(dir, 'Library', 'Collections'))).toBeNull();
  });

  test('annotations are written back with a valid hash', async () => {
    const api = backend.api;
    await api.library.createCollection('C');
    const p = await api.library.createProject({ collection: 'C', name: 'A' });
    const main = join(p, 'main.md');
    await api.files.saveDocument({ path: main, text: 'Human text. AI text.\n', spans: [{ author: '@Me', from: 0, to: 12 }, { author: '&Claude', from: 12, to: 20 }] });
    const doc = await api.files.readDocument(main);
    expect(doc.annotationStatus).toBe('valid');
    expect(doc.text).toBe('Human text. AI text.\n');
    expect(doc.annotations!.authors.map((a) => [a.key, a.ranges])).toEqual([
      ['@Me', [[0, 12]]],
      ['&Claude', [[12, 8]]],
    ]);
  });
});
