// A stand-in for the Swift shell, in Node, for testing the iPad web bundle in Chromium.
// It answers the same requests (see Bridge.swift) on the real file system, under a temporary
// "container" folder, and prints PDFs with Chromium. It is a reference for the protocol, not a
// model of iOS: file coordination, bookmarks and the Keychain are reduced to plain files.

import { promises as fs, constants } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';

const ok = (value = null) => ({ ok: true, value });
const fail = (code, message) => ({ ok: false, code, message });

function typeOf(st) {
  return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
}

export function createMockShell({ home, web, version = '0.0.0', selfTest = false, dialogs = {}, http, page, context }) {
  const support = join(home, 'Library', 'Application Support');
  const secrets = new Map();
  const watchers = new Map();
  const log = [];
  let assetRoots = [];
  let selfTestPending = selfTest;
  // The folders requests may touch: the container and the bundled web folder (read only).
  const allowed = (p, write) => {
    const r = resolve(p);
    if (r === home || r.startsWith(home + sep)) return true;
    if (!write && (r === web || r.startsWith(web + sep))) return true;
    return (dialogs.pickedFolders ?? []).some((f) => r === f || r.startsWith(f + sep));
  };
  const guard = (p, write = false) => {
    if (typeof p !== 'string' || !p.startsWith('/')) throw Object.assign(new Error(`Not an absolute path: ${p}`), { code: 'EINVAL' });
    if (!allowed(p, write)) throw Object.assign(new Error(`Not permitted, ${p}`), { code: 'EACCES' });
  };

  const send = (event) => page().evaluate((e) => window.__folioDispatch?.(e), event).catch(() => undefined);

  const ops = {
    'app.info': async () => {
      const value = { home, web, support, version, folders: [], selfTest: selfTestPending };
      selfTestPending = false;
      return value;
    },
    log: async ({ message }) => {
      log.push(message);
      return null;
    },
    'fs.stat': async ({ path, follow }) => {
      guard(path);
      const st = follow ? await fs.stat(path) : await fs.lstat(path);
      return { type: typeOf(st), size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, birthtimeMs: st.birthtimeMs, mode: st.mode, ino: st.ino, dev: st.dev };
    },
    'fs.readdir': async ({ path }) => {
      guard(path);
      return (await fs.readdir(path, { withFileTypes: true })).map((d) => ({ name: d.name, type: d.isSymbolicLink() ? 'link' : d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other' }));
    },
    'fs.read': async ({ path, encoding, offset, length }) => {
      guard(path);
      if (offset !== undefined) {
        const fh = await fs.open(path, 'r');
        try {
          const buf = Buffer.alloc(length);
          const { bytesRead } = await fh.read(buf, 0, length, offset);
          return buf.subarray(0, bytesRead).toString(encoding === 'utf8' ? 'utf8' : 'base64');
        } finally {
          await fh.close();
        }
      }
      return (await fs.readFile(path)).toString(encoding === 'utf8' ? 'utf8' : 'base64');
    },
    'fs.write': async ({ path, data, encoding, flag }) => {
      guard(path, true);
      const bytes = Buffer.from(data, encoding === 'utf8' ? 'utf8' : 'base64');
      if (flag === 'a') await fs.appendFile(path, bytes);
      else await fs.writeFile(path, bytes, { flag: flag === 'wx' ? 'wx' : 'w' });
      return null;
    },
    'fs.mkdir': async ({ path, recursive }) => {
      guard(path, true);
      await fs.mkdir(path, { recursive });
      return null;
    },
    'fs.rename': async ({ from, to }) => {
      guard(from, true);
      guard(to, true);
      await fs.rename(from, to);
      return null;
    },
    'fs.rm': async ({ path, recursive, force }) => {
      guard(path, true);
      await fs.rm(path, { recursive, force });
      return null;
    },
    'fs.copy': async ({ from, to }) => {
      guard(from);
      guard(to, true);
      await fs.copyFile(from, to);
      return null;
    },
    'fs.realpath': async ({ path }) => {
      guard(path);
      return fs.realpath(path);
    },
    'fs.truncate': async ({ path, length }) => {
      guard(path, true);
      await fs.truncate(path, length);
      return null;
    },
    'fs.chmod': async ({ path, mode }) => {
      guard(path, true);
      await fs.chmod(path, mode);
      return null;
    },
    'fs.xattr.get': async ({ path }) => {
      guard(path);
      await fs.access(path, constants.F_OK);
      return null;
    },
    'fs.xattr.set': async ({ path }) => {
      guard(path, true);
      return null;
    },
    // The shell's NSFilePresenter reports changes made by other apps; here the test reports them with notify().
    'fs.watch': async ({ id, path }) => {
      guard(path);
      watchers.set(id, path);
      return null;
    },
    'fs.unwatch': async ({ id }) => {
      watchers.delete(id);
      return null;
    },
    'files.trash': async ({ path }) => {
      guard(path, true);
      const trash = join(home, '.Trash');
      await fs.mkdir(trash, { recursive: true });
      await fs.rename(path, join(trash, `${Date.now()} ${path.split('/').pop()}`));
      return null;
    },
    'files.reveal': async ({ path }) => {
      log.push(`reveal ${path}`);
      return null;
    },
    'assets.roots': async ({ roots }) => {
      assetRoots = roots;
      return null;
    },
    'menu.set': async () => null,
    'dialog.confirm': async ({ message }) => {
      log.push(`confirm ${message}`);
      return dialogs.confirm ?? true;
    },
    'dialog.folder': async () => dialogs.folder ?? null,
    'dialog.files': async () => dialogs.files ?? [],
    'dialog.save': async ({ name }) => (dialogs.saveFolder ? join(dialogs.saveFolder, name) : null),
    'clipboard.read': async () => dialogs.clipboard ?? '',
    'secrets.has': async ({ name }) => secrets.has(name),
    'secrets.set': async ({ name, value }) => {
      if (value === null) secrets.delete(name);
      else secrets.set(name, value);
      return null;
    },
    'spell.check': async ({ words }) => words.filter((w) => /^(speling|teh)$/i.test(w)),
    'spell.suggest': async ({ word }) => (word.toLowerCase() === 'speling' ? ['spelling'] : []),
    'spell.learn': async () => null,
    'http.start': async ({ id, url, method, headers, body }) => {
      // Put the keys in place of their stand-ins, as HttpProxy.swift does.
      const real = {};
      for (const [k, v] of Object.entries(headers)) {
        real[k] = v.replace(/folio-keychain-([A-Za-z0-9._%-]+)/g, (m, enc) => secrets.get(decodeURIComponent(enc)) ?? m);
      }
      const request = { url, method, headers: real, body: body ? Buffer.from(body, 'base64').toString('utf8') : null };
      (async () => {
        try {
          const res = await http(request);
          await send({ type: 'http.head', id, status: res.status, headers: res.headers ?? {} });
          for (const chunk of res.chunks ?? []) await send({ type: 'http.data', id, data: Buffer.from(chunk).toString('base64') });
          await send({ type: 'http.end', id });
        } catch (e) {
          await send({ type: 'http.end', id, error: String(e?.message ?? e) });
        }
      })();
      return null;
    },
    'http.cancel': async () => null,
    'print.pdf': async (input) => {
      const p = await context().newPage();
      try {
        await p.goto('http://folio.test/print.html');
        const layout = await p.evaluate((i) => window.__mdeRender({ ...i, print: true }), input);
        const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false, outline: false });
        return { pdf: Buffer.from(pdf).toString('base64'), inserts: layout?.inserts ?? [] };
      } finally {
        await p.close();
      }
    },
    'print.web': async (input) => {
      const p = await context().newPage();
      try {
        await p.goto('http://folio.test/print.html');
        return await p.evaluate((i) => window.__mdeRenderWeb(i), input);
      } finally {
        await p.close();
      }
    },
  };

  async function handle(message) {
    const fn = ops[message?.op];
    if (!fn) return fail('ENOSYS', `Unknown request ${message?.op}`);
    try {
      return ok(await fn(message));
    } catch (e) {
      const code = e?.code && /^E[A-Z]+$/.test(e.code) ? e.code : undefined;
      return fail(code, String(e?.message ?? e));
    }
  }

  return {
    handle,
    log,
    secrets,
    assetRoots: () => assetRoots,
    /** Reports files changed outside the app to the watchers whose folder holds them. */
    async notify(paths) {
      for (const [id, root] of watchers) {
        const inside = paths.filter((p) => p.startsWith(root + sep)).map((p) => relative(root, p));
        if (inside.length) await send({ type: 'fs.change', id, paths: inside });
      }
    },
    async close() {
      watchers.clear();
    },
    relative: (p) => relative(home, p),
    dirname,
  };
}
