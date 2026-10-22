// Files that come from elsewhere (shared or synced projects, history files, theme packages) must
// not lead the app to read or write outside the library, and saving must not lose what a file
// carries besides its text.

import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { FINDER_TAGS_ATTR, HISTORY_MAGIC, encodeBlobRecord, encodeSnapshotRecord, sha256Hex } from '@mde/core';
import { createBackend, type Backend, type HostAdapter } from '../src/index';
import { resolvesInside } from '../src/fsutil';

let dir: string;
let lib: string;
const xattrs = new Map<string, Uint8Array>();
let backend: Backend;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mde-safety-'));
  lib = join(dir, 'Library');
  const seed = join(dir, 'seed');
  await mkdir(join(seed, 'Themes', 'Classic'), { recursive: true });
  await writeFile(join(seed, 'Themes', 'Classic', 'theme.css'), 'body { font-family: serif; }');
  xattrs.clear();
  const host: HostAdapter = {
    trash: async (p) => rm(p, { recursive: true }),
    reveal: () => undefined,
    renderPdf: async () => ({ pdf: new TextEncoder().encode('%PDF-fake'), inserts: [] }),
    chooseSavePath: async () => null,
    chooseFolder: async () => null,
    chooseFiles: async () => [],
    renderWebPage: async (input) => input.html,
    readXattr: async (p, n) => xattrs.get(`${p}\0${n}`) ?? null,
    writeXattr: async (p, n, v) => void (v ? xattrs.set(`${p}\0${n}`, v) : xattrs.delete(`${p}\0${n}`)),
    emit: () => undefined,
    secrets: { get: async () => null, set: async () => undefined },
  };
  backend = await createBackend({ host, settingsPath: join(dir, 'settings.json'), seedDir: seed, version: 'test', platform: 'test', libraryPath: lib, history: { idleMs: 50 } });
});

afterEach(async () => {
  await backend.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function project(name = 'P'): Promise<string> {
  await backend.api.library.createCollection('C').catch(() => undefined);
  return backend.api.library.createProject({ collection: 'C', name });
}

describe('history files are data', () => {
  test('a version naming a file outside the project is not restored', async () => {
    const p = await project();
    const pack = join(p, '.mdeditor', 'history.mdh');
    const data = new TextEncoder().encode('PWNED');
    const h = sha256Hex(data);
    await writeFile(
      pack,
      Buffer.concat([HISTORY_MAGIC, encodeBlobRecord(h, data), encodeSnapshotRecord({ id: 'evil', time: Date.now(), kind: 'checkpoint', name: 'Evil', files: { '../../../../outside.txt': { h, s: data.length } } })]),
    );
    await expect(backend.api.history.restoreProject(p, 'evil')).rejects.toThrow(/outside/);
    await expect(backend.api.history.restoreFile(p, 'evil', '../../../../outside.txt')).rejects.toThrow(/outside/);
    await expect(backend.api.history.diff(p, 'evil', '../../../../outside.txt', 'current')).rejects.toThrow(/outside/);
    await expect(stat(join(dir, 'outside.txt'))).rejects.toThrow();
  });

  test('restoring a file from a version that removed it brings it back', async () => {
    const p = await project();
    await writeFile(join(p, 'extra.md'), 'Extra\n');
    await backend.api.history.checkpoint(p, 'With extra');
    await rm(join(p, 'extra.md'));
    const removed = await backend.api.history.checkpoint(p, 'Without extra');
    await backend.api.history.restoreFile(p, removed!.id, 'extra.md');
    expect(await readFile(join(p, 'extra.md'), 'utf8')).toBe('Extra\n');
    await expect(backend.api.history.restoreFile(p, removed!.id, 'never.md')).rejects.toThrow(/not in this version/);
  });

  test('a history file cut short before its header is started again', async () => {
    const p = await project();
    const pack = join(p, '.mdeditor', 'history.mdh');
    await writeFile(pack, HISTORY_MAGIC.subarray(0, 2));
    expect(await backend.api.history.checkpoint(p, 'After')).toMatchObject({ name: 'After' });
    expect((await backend.api.history.list(p)).map((s) => s.name)).toContain('After');
  });

  test('an unreadable history file is kept aside and a new history starts', async () => {
    const p = await project();
    await writeFile(join(p, '.mdeditor', 'history.mdh'), 'not a history file at all');
    expect(await backend.api.history.checkpoint(p, 'Fresh')).toMatchObject({ name: 'Fresh' });
    expect((await backend.api.history.list(p)).map((s) => s.name)).toEqual(['Fresh']);
  });
});

describe('project.json is data', () => {
  test('references outside the project are neither listed nor sent', async () => {
    const p = await project();
    await writeFile(join(dir, 'secret.json'), '{"token":"s3cret"}');
    await mkdir(join(p, 'References'), { recursive: true });
    await writeFile(join(p, 'References', 'brief.txt'), 'The brief.');
    await backend.api.project.updateMeta(p, { references: ['../../../../secret.json', 'References/brief.txt'] });
    const list = await backend.api.references.list(p);
    expect(list.map((r) => r.rel)).toEqual(['References/brief.txt']);
  });

  test('two changes at once both land', async () => {
    const p = await project();
    await mkdir(join(p, 'References'), { recursive: true });
    await writeFile(join(p, 'References', 'a.txt'), 'A');
    await writeFile(join(p, 'References', 'b.txt'), 'B');
    await Promise.all([backend.api.references.setIncluded(p, 'References/a.txt', true), backend.api.references.setIncluded(p, 'References/b.txt', true)]);
    expect((await backend.api.project.details(p)).meta.references?.sort()).toEqual(['References/a.txt', 'References/b.txt']);
  });
});

describe('symbolic links', () => {
  test('a link inside the library to a file outside it does not resolve inside', async () => {
    const p = await project();
    await writeFile(join(dir, 'private.txt'), 'private');
    await symlink(join(dir, 'private.txt'), join(p, 'link.txt'));
    expect(await resolvesInside(join(p, 'link.txt'), [lib])).toBe(false);
    expect(await resolvesInside(join(p, 'main.md'), [lib])).toBe(true);
    expect(await resolvesInside(join(p, 'missing.md'), [lib])).toBe(false);
  });

  test('a content block through a link to outside the library is not included', async () => {
    const p = await project();
    await writeFile(join(dir, 'private.md'), 'PRIVATE TEXT');
    await symlink(join(dir, 'private.md'), join(p, 'linked.md'));
    await writeFile(join(p, 'main.md'), '# Doc\n\n/linked.md\n');
    const r = await backend.api.render.document({ docPath: join(p, 'main.md') });
    expect(r.html).not.toContain('PRIVATE TEXT');
  });

  test('writes through a linked folder that leads outside the library are refused', async () => {
    const p = await project();
    await mkdir(join(dir, 'outside'));
    await symlink(join(dir, 'outside'), join(p, 'linkdir'));
    await expect(backend.api.files.writeText(join(p, 'linkdir', 'x.md'), 'x')).rejects.toThrow(/outside the library/);
    await expect(backend.api.files.createFile(join(p, 'linkdir'), 'y.md', '')).rejects.toThrow(/outside the library/);
    await expect(stat(join(dir, 'outside', 'x.md'))).rejects.toThrow();
  });

  test('saving a linked file inside the library keeps the link', async () => {
    const p = await project();
    await writeFile(join(p, 'real.md'), 'Before\n');
    await symlink(join(p, 'real.md'), join(p, 'alias.md'));
    await backend.api.files.saveDocument({ path: join(p, 'alias.md'), text: 'After\n' });
    expect(await readFile(join(p, 'real.md'), 'utf8')).toBe('After\n');
  });
});

describe('saving keeps what a file carries besides its text', () => {
  test('permissions and Finder tags', async () => {
    const p = await project();
    const file = join(p, 'main.md');
    await chmod(file, 0o600);
    const tags = new TextEncoder().encode('tags');
    xattrs.set(`${file}\0${FINDER_TAGS_ATTR}`, tags);
    await backend.api.files.saveDocument({ path: file, text: 'Saved\n' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(xattrs.get(`${file}\0${FINDER_TAGS_ATTR}`)).toEqual(tags);
  });

  test('a file that is not UTF-8 is not opened', async () => {
    const p = await project();
    await writeFile(join(p, 'latin1.md'), Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x0a]));
    await expect(backend.api.files.readDocument(join(p, 'latin1.md'))).rejects.toThrow(/not UTF-8/);
  });
});

describe('names', () => {
  test('a rename onto another file whose name differs only in case is refused', async () => {
    const p = await project();
    await writeFile(join(p, 'Notes.md'), 'UPPER');
    let caseSensitive = true;
    try {
      await writeFile(join(p, 'notes.md'), 'lower', { flag: 'wx' });
    } catch {
      caseSensitive = false;
    }
    if (!caseSensitive) return;
    await expect(backend.api.library.rename(join(p, 'Notes.md'), 'notes.md')).rejects.toThrow(/already exists/);
    expect(await readFile(join(p, 'notes.md'), 'utf8')).toBe('lower');
  });

  test('library folders cannot be renamed, and template names cannot lead elsewhere', async () => {
    await expect(backend.api.library.rename(join(lib, 'Collections'), 'Stuff')).rejects.toThrow(/cannot be renamed/);
    await backend.api.library.createCollection('C');
    await expect(backend.api.library.createProject({ collection: 'C', name: 'x', template: '../Collections/C' })).rejects.toThrow(/does not exist/);
  });

  test('a name longer than 255 bytes is refused before it reaches the disk', async () => {
    await expect(backend.api.library.createCollection('😀'.repeat(70))).rejects.toThrow(/too long/);
  });
});

describe('themes', () => {
  test('a package that unpacks to too much is refused before unpacking', async () => {
    const big = new Uint8Array(301 * 1024 * 1024);
    const file = join(dir, 'bomb.mdtheme');
    await writeFile(file, zipSync({ 'theme.css': strToU8('body{}'), 'pad.bin': big }, { level: 9 }));
    await expect(backend.api.themes.importTheme(file)).rejects.toThrow(/unpacks to more than/);
  });

  test('a theme.json that is not valid JSON does not stop rendering', async () => {
    const p = await project();
    await writeFile(join(lib, 'Themes', 'Classic', 'theme.json'), '{ not json');
    await backend.api.project.updateMeta(p, { theme: 'Classic' });
    const r = await backend.api.render.document({ docPath: join(p, 'main.md') });
    expect(r.html).toContain('<h1');
  });
});

describe('settings', () => {
  test('quick successive changes end with the last one on disk', async () => {
    const changes = Array.from({ length: 30 }, (_, i) => backend.api.settings.update({ editorFont: `Font ${i}` }));
    await Promise.all(changes);
    const saved = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as { prefs: { editorFont: string } };
    expect(saved.prefs.editorFont).toBe('Font 29');
  });
});
