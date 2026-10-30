// A stand-in for Dropbox's HTTP API (the calls the web app makes), for the web app's tests: an
// in-memory Dropbox with sign-in, listing with change cursors, upload modes and conflict copies.
// Test hooks: GET /__test/files, POST /__test/write {path, text} (a change made elsewhere).
import { createServer } from 'node:http';

export function mockDropbox() {
  /** path_lower → { path, kind, data?, rev?, mtime } */
  const items = new Map();
  const log = []; // { seq, lower }
  let seq = 0;
  let revs = 0;
  let token = 'tok-1';
  const lower = (p) => p.toLowerCase();
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const touch = (l) => log.push({ seq: ++seq, lower: l });
  const meta = (it) =>
    it.kind === 'dir'
      ? { '.tag': 'folder', name: it.path.split('/').pop(), path_lower: lower(it.path), path_display: it.path, id: `id:${lower(it.path)}` }
      : { '.tag': 'file', name: it.path.split('/').pop(), path_lower: lower(it.path), path_display: it.path, id: `id:${lower(it.path)}`, rev: it.rev, size: it.data.length, client_modified: it.mtime, server_modified: it.mtime };
  const ensureDirs = (p) => {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const d = `/${parts.slice(0, i).join('/')}`;
      if (!items.has(lower(d))) {
        items.set(lower(d), { path: d, kind: 'dir' });
        touch(lower(d));
      }
    }
  };
  const write = (p, data) => {
    ensureDirs(p);
    const existing = items.get(lower(p));
    const it = { path: existing?.path ?? p, kind: 'file', data, rev: `r${++revs}`, mtime: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    items.set(lower(p), it);
    touch(lower(p));
    return it;
  };
  const conflictName = (p, tag) => {
    const dir = parent(p);
    const name = p.split('/').pop();
    const dot = name.lastIndexOf('.');
    for (let n = 1; ; n++) {
      const label = tag === 'conflict' ? ` (conflicted copy${n > 1 ? ` ${n}` : ''})` : ` (${n})`;
      const candidate = `${dir}/${dot > 0 ? name.slice(0, dot) + label + name.slice(dot) : name + label}`;
      if (!items.has(lower(candidate))) return candidate;
    }
  };
  const under = (l, root) => l === root || l.startsWith(`${root}/`) || root === '';
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Dropbox-API-Arg', 'Access-Control-Expose-Headers': 'Dropbox-API-Result', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const send = (res, status, body, headers = {}) => {
    const isBytes = body instanceof Uint8Array;
    res.writeHead(status, { ...cors, 'Content-Type': isBytes ? 'application/octet-stream' : 'application/json', ...headers });
    res.end(isBytes ? Buffer.from(body) : JSON.stringify(body));
  };
  const conflict = (res, summary) => send(res, 409, { error_summary: summary, error: { '.tag': summary.split('/')[0] } });
  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    });
  const stats = { uploads: 0, requests: 0 };

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://x');
    const body = await readBody(req);
    stats.requests++;
    // ---- test hooks
    if (url.pathname === '/__test/files') return send(res, 200, Object.fromEntries([...items.values()].filter((i) => i.kind === 'file').map((i) => [i.path, Buffer.from(i.data).toString('utf8')])));
    if (url.pathname === '/__test/write') {
      const { path, text } = JSON.parse(Buffer.from(body).toString('utf8'));
      return send(res, 200, meta(write(path, new TextEncoder().encode(text))));
    }
    if (url.pathname === '/__test/stats') return send(res, 200, stats);
    if (url.pathname === '/__test/expire') {
      token = `tok-${Date.now()}`;
      return send(res, 200, {});
    }
    // ---- sign-in
    if (url.pathname === '/oauth2/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'code-1');
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (url.pathname === '/oauth2/token') {
      const form = new URLSearchParams(Buffer.from(body).toString('utf8'));
      if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'code-1' && form.get('code_verifier')) return send(res, 200, { access_token: token, expires_in: 14400, refresh_token: 'refresh-1', token_type: 'bearer' });
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'refresh-1') return send(res, 200, { access_token: token, expires_in: 14400, token_type: 'bearer' });
      return send(res, 400, { error: 'invalid_grant' });
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error_summary: 'expired_access_token/' });
    const arg = req.headers['dropbox-api-arg'] ? JSON.parse(String(req.headers['dropbox-api-arg'])) : JSON.parse(Buffer.from(body).toString('utf8') || '{}');
    switch (url.pathname) {
      case '/2/files/list_folder': {
        const root = lower(arg.path);
        if (root && !items.has(root)) return conflict(res, 'path/not_found/');
        const entries = [...items.values()].filter((i) => i.path && under(lower(i.path), root) && lower(i.path) !== root).map(meta);
        return send(res, 200, { entries, cursor: `c:${seq}:${root}`, has_more: false });
      }
      case '/2/files/list_folder/continue': {
        const [, from, root] = String(arg.cursor).match(/^c:(\d+):(.*)$/) ?? [];
        if (from === undefined) return conflict(res, 'reset/');
        const changed = [...new Set(log.filter((l) => l.seq > Number(from) && under(l.lower, root) && l.lower !== root).map((l) => l.lower))];
        const entries = changed.map((l) => (items.has(l) ? meta(items.get(l)) : { '.tag': 'deleted', name: l.split('/').pop(), path_lower: l, path_display: l }));
        return send(res, 200, { entries, cursor: `c:${seq}:${root}`, has_more: false });
      }
      case '/2/files/create_folder_v2': {
        if (items.has(lower(arg.path))) return conflict(res, 'path/conflict/folder/');
        ensureDirs(`${arg.path}/x`);
        return send(res, 200, { metadata: meta(items.get(lower(arg.path))) });
      }
      case '/2/files/move_v2': {
        const from = lower(arg.from_path);
        if (!items.has(from)) return conflict(res, 'from_lookup/not_found/');
        if (items.has(lower(arg.to_path))) return conflict(res, 'to/conflict/file/');
        ensureDirs(arg.to_path);
        for (const [l, it] of [...items]) {
          if (l !== from && !l.startsWith(`${from}/`)) continue;
          items.delete(l);
          touch(l);
          const path = arg.to_path + it.path.slice(arg.from_path.length);
          items.set(lower(path), { ...it, path });
          touch(lower(path));
        }
        return send(res, 200, { metadata: meta(items.get(lower(arg.to_path))) });
      }
      case '/2/files/delete_v2': {
        const p = lower(arg.path);
        if (!items.has(p)) return conflict(res, 'path_lookup/not_found/');
        for (const l of [...items.keys()]) if (l === p || l.startsWith(`${p}/`)) {
          items.delete(l);
          touch(l);
        }
        return send(res, 200, { metadata: { '.tag': 'file', path_lower: p } });
      }
      case '/2/files/download': {
        const it = items.get(lower(arg.path));
        if (!it || it.kind !== 'file') return conflict(res, 'path/not_found/');
        return send(res, 200, it.data, { 'Dropbox-API-Result': JSON.stringify(meta(it)) });
      }
      case '/2/files/upload': {
        stats.uploads++;
        let path = arg.path;
        const existing = items.get(lower(path));
        const mode = arg.mode;
        if (existing && mode === 'add') path = conflictName(path, 'add');
        else if (existing && mode?.['.tag'] === 'update' && existing.rev !== mode.update) path = conflictName(path, 'conflict');
        return send(res, 200, meta(write(path, body)));
      }
      default:
        return send(res, 404, { error_summary: `unknown ${url.pathname}` });
    }
  });
  return {
    items,
    stats,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
