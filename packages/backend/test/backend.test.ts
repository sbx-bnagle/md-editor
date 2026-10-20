import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type { AppEvent } from '@mde/core';
import { createBackend, type Backend, type HostAdapter } from '../src/index';

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
    renderPdf: async () => new TextEncoder().encode('%PDF-fake'),
    chooseSavePath: async () => null,
    chooseFolder: async () => null,
    emit: (e) => events.push(e),
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
    await new Promise((r) => setTimeout(r, 150));
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
