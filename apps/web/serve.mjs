// Serves apps/web/dist on this computer, to try the web app (http://localhost is allowed to sign in
// and to run the service worker; phones and tablets need the app on an HTTPS address).
// Usage: npm run serve -w @mde/web [-- --port 8080]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const portArg = process.argv.indexOf('--port');
const port = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.md': 'text/plain; charset=utf-8',
};

export function serve(dir = dist, p = port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = normalize(join(dir, decodeURIComponent(url.pathname)));
      if (path !== dir && !path.startsWith(dir + sep)) throw new Error('outside');
      if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(p, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await serve();
  console.log(`Folio Dome web app: http://localhost:${port}/`);
}
