// Extended attributes for Finder tags. On macOS they are read and written with /usr/bin/xattr
// (Node has no API for them). Elsewhere (tests on Linux) they are kept in a JSON file in the
// app's data folder, so the feature behaves the same.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const XATTR = '/usr/bin/xattr';

export interface Xattrs {
  read(path: string, name: string): Promise<Uint8Array | null>;
  write(path: string, name: string, value: Uint8Array | null): Promise<void>;
}

const missing = (e: unknown) => /No such xattr/i.test(`${(e as { stderr?: string }).stderr ?? ''} ${(e as Error).message ?? ''}`);

function macXattrs(): Xattrs {
  return {
    async read(path, name) {
      try {
        const { stdout } = await run(XATTR, ['-px', name, path]);
        return Uint8Array.from(Buffer.from(stdout.replace(/\s+/g, ''), 'hex'));
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    async write(path, name, value) {
      if (value === null) {
        await run(XATTR, ['-d', name, path]).catch((e) => {
          if (!missing(e)) throw e;
        });
        return;
      }
      await run(XATTR, ['-wx', name, Buffer.from(value).toString('hex'), path]);
    },
  };
}

function fileXattrs(file: string): Xattrs {
  let queue: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<Record<string, Record<string, string>>> => JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
  return {
    async read(path, name) {
      const v = (await load())[path]?.[name];
      return v === undefined ? null : Uint8Array.from(Buffer.from(v, 'base64'));
    },
    write(path, name, value) {
      const next = queue.then(async () => {
        const all = await load();
        const attrs = (all[path] ??= {});
        if (value === null) delete attrs[name];
        else attrs[name] = Buffer.from(value).toString('base64');
        if (!Object.keys(attrs).length) delete all[path];
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(all, null, 2));
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

export function createXattrs(fallbackFile: string): Xattrs {
  return process.platform === 'darwin' ? macXattrs() : fileXattrs(fallbackFile);
}
