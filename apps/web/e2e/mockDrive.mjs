// A stand-in for the Google Drive API (v3) and Google's sign-in, for the web app's tests: files by
// id with parents, folder listings, multipart and media uploads, renames, moves and trash, the change
// log, and the app's hidden data folder. Helpers: fileText(path), writeText(path, text) (a change
// made elsewhere), with paths from My Drive.
import { createServer } from 'node:http';

export function mockDrive() {
  const files = new Map(); // id → { id, name, mimeType, parents, data, version, modifiedTime, trashed, space }
  const log = []; // { seq, id }
  let seq = 1;
  let ids = 0;
  const token = 'gtok-1';
  const FOLDER = 'application/vnd.google-apps.folder';
  const now = () => new Date().toISOString();
  const touch = (id) => log.push({ seq: ++seq, id });
  const create = (meta, data) => {
    const f = { id: `f${++ids}`, name: meta.name, mimeType: meta.mimeType ?? 'application/octet-stream', parents: meta.parents ?? ['root'], data: data ?? null, version: '1', modifiedTime: now(), trashed: false, space: meta.parents?.[0] === 'appDataFolder' ? 'appDataFolder' : 'drive' };
    files.set(f.id, f);
    touch(f.id);
    return f;
  };
  const out = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, version: f.version, modifiedTime: f.modifiedTime, trashed: f.trashed, ...(f.data ? { size: String(f.data.length) } : {}) });
  const childByName = (parent, name) => [...files.values()].find((f) => !f.trashed && f.parents.includes(parent) && f.name === name);
  const idOfPath = (path) => {
    let id = 'root';
    for (const name of path.split('/')) {
      const f = childByName(id, name);
      if (!f) return null;
      id = f.id;
    }
    return id;
  };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' };
  const send = (res, status, body) => {
    const bytes = body instanceof Uint8Array;
    res.writeHead(status, { ...cors, 'Content-Type': bytes ? 'application/octet-stream' : 'application/json' });
    res.end(bytes ? Buffer.from(body) : JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  const multipart = (buf, type) => {
    const boundary = /boundary=([^;]+)/.exec(type)[1];
    const text = buf.toString('latin1');
    const parts = text.split(`--${boundary}`).slice(1, -1);
    const body = (p) => p.slice(p.indexOf('\r\n\r\n') + 4, p.endsWith('\r\n') ? -2 : undefined);
    return { meta: JSON.parse(Buffer.from(body(parts[0]), 'latin1').toString('utf8')), data: new Uint8Array(Buffer.from(body(parts[1]), 'latin1')) };
  };

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://x');
    const body = await readBody(req);
    if (url.pathname === '/o/oauth2/v2/auth') {
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.hash = new URLSearchParams({ access_token: token, expires_in: '3600', token_type: 'Bearer', state: url.searchParams.get('state'), scope: url.searchParams.get('scope') }).toString();
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: { message: 'Invalid Credentials' } });
    const m = /^\/(upload\/)?drive\/v3\/(files|changes)(?:\/([^/]+))?(?:\/(\w+))?$/.exec(url.pathname);
    if (!m) return send(res, 404, { error: { message: 'not found' } });
    const [, upload, kind, id] = m;
    if (kind === 'changes') {
      if (id === 'startPageToken') return send(res, 200, { startPageToken: String(seq) });
      const from = Number(url.searchParams.get('pageToken'));
      if (!Number.isFinite(from)) return send(res, 400, { error: { message: 'bad token' } });
      const changed = [...new Set(log.filter((l) => l.seq > from).map((l) => l.id))];
      const changes = changed.map((fid) => files.get(fid)).filter((f) => f && f.space === 'drive').map((f) => ({ fileId: f.id, removed: false, file: out(f) }));
      return send(res, 200, { changes, newStartPageToken: String(seq) });
    }
    if (req.method === 'GET' && !id) {
      const q = url.searchParams.get('q') ?? '';
      const space = url.searchParams.get('spaces') ?? 'drive';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const name = /name = '([^']+)'/.exec(q)?.[1];
      const list = [...files.values()].filter((f) => f.space === space && !f.trashed && (!parent || f.parents.includes(parent)) && (!name || f.name === name));
      return send(res, 200, { files: list.map(out) });
    }
    const f = id ? files.get(id) : null;
    if (id && !f) return send(res, 404, { error: { message: 'File not found' } });
    if (req.method === 'GET') return url.searchParams.get('alt') === 'media' ? send(res, 200, f.data ?? new Uint8Array()) : send(res, 200, out(f));
    if (req.method === 'POST' && !upload) return send(res, 200, out(create(JSON.parse(body.toString('utf8')))));
    if (req.method === 'POST' && upload) {
      const { meta, data } = multipart(body, req.headers['content-type']);
      return send(res, 200, out(create(meta, data)));
    }
    if (req.method === 'PATCH' && upload) {
      f.data = new Uint8Array(body);
      f.version = String(Number(f.version) + 1);
      f.modifiedTime = now();
      touch(f.id);
      return send(res, 200, out(f));
    }
    if (req.method === 'PATCH') {
      const patch = body.length ? JSON.parse(body.toString('utf8')) : {};
      if (patch.name) f.name = patch.name;
      if (patch.trashed) f.trashed = true;
      const add = url.searchParams.get('addParents');
      const remove = url.searchParams.get('removeParents');
      if (add) f.parents = [...f.parents.filter((p) => p !== remove), add];
      f.modifiedTime = now();
      touch(f.id);
      return send(res, 200, out(f));
    }
    return send(res, 405, { error: { message: 'method' } });
  });
  return {
    files,
    fileText: (path) => {
      const fid = idOfPath(path);
      const f = fid && files.get(fid);
      return f?.data ? Buffer.from(f.data).toString('utf8') : null;
    },
    writeText: (path, text) => {
      const f = files.get(idOfPath(path));
      f.data = new TextEncoder().encode(text);
      f.version = String(Number(f.version) + 1);
      f.modifiedTime = now();
      touch(f.id);
    },
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
