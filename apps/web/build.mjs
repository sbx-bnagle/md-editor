// Builds the web app into apps/web/dist, a folder of static files to put on any web server with
// HTTPS (or to try on this computer with `npm run serve -w @mde/web`):
//
//   index.html, preview.html, print.html, assets/   the UI (packages/ui/dist), with the host script
//   web-host.js   the host (src/main.ts): the backend in the page, Node's modules replaced by src/shims
//   sw.js         the service worker that serves the library's images and fonts to the page
//   oauth.html    where Dropbox and Google send the user back after signing in
//   app/          the seed library, components and thesaurus, listed in app-files.json
//   config.json   the Dropbox app key and Google client ID, if filled in (see docs/WEB.md)
import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(here, 'dist');
const shims = join(here, 'src', 'shims');
const version = JSON.parse(await readFile(join(here, 'package.json'), 'utf8')).version;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const uiDist = join(root, 'packages', 'ui', 'dist');
if (!existsSync(uiDist)) throw new Error('UI not built: run `npm run build -w @mde/ui` first.');
await cp(uiDist, dist, { recursive: true, filter: (src) => !src.endsWith('.map') });

const common = { bundle: true, platform: 'browser', target: ['safari16', 'chrome110', 'firefox115'], minify: true, sourcemap: false, legalComments: 'external', logLevel: 'warning' };
await build({
  ...common,
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(dist, 'web-host.js'),
  format: 'iife',
  alias: {
    'node:fs': join(shims, 'fs.ts'),
    'node:path': join(shims, 'path.ts'),
    'node:os': join(shims, 'os.ts'),
    'node:crypto': join(shims, 'crypto.ts'),
  },
  // pdf.js loads Node modules only when it runs in Node; in the page those imports are never reached.
  external: ['node:*', 'fs', 'path', 'url', 'canvas', 'module'],
  define: { 'process.env.NODE_ENV': '"production"', __VERSION__: JSON.stringify(version) },
});
await build({ ...common, entryPoints: [join(here, 'src', 'sw.ts')], outfile: join(dist, 'sw.js'), format: 'iife' });

// The page talks to Dropbox, Google and the AI services itself, so it may connect to https: addresses
// (and to this computer, for local AI servers such as Ollama and for tests).
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-src 'self'";
const indexPath = join(dist, 'index.html');
let index = await readFile(indexPath, 'utf8');
if (!index.includes('<script type="module"')) throw new Error('index.html has no module script to put the host before.');
index = index
  .replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/, `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  .replace(
    '<title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n    <meta name="theme-color" content="#1a1b1d" />\n    <meta name="apple-mobile-web-app-capable" content="yes" />\n    <link rel="manifest" href="./manifest.webmanifest" />\n    <link rel="apple-touch-icon" href="./icon-1024.png" />\n    <title>',
  )
  .replace('<script type="module"', '<script src="./web-host.js"></script>\n    <script type="module"');
if (!index.includes(CSP)) throw new Error('index.html: the content security policy was not replaced.');
await writeFile(indexPath, index);

await cp(join(here, 'public'), dist, { recursive: true });
await cp(join(root, 'resources', 'icon', 'icon-1024.png'), join(dist, 'icon-1024.png'));

// The app's own files, read through the /app mount.
const app = join(dist, 'app');
await cp(join(root, 'resources', 'seed'), join(app, 'seed'), { recursive: true });
// Themes kept out of the repository (resources/private/Themes) have licensed fonts and client details:
// a web build is served to anyone with its address, so they are left out unless asked for.
const privateThemes = join(root, 'resources', 'private', 'Themes');
if (existsSync(privateThemes) && process.env.FOLIO_PRIVATE_THEMES === '1') await cp(privateThemes, join(app, 'seed', 'Themes'), { recursive: true });

const thesaurusScript = join(root, 'scripts', 'build-thesaurus.mjs');
const cache = join(root, 'node_modules', '.cache', 'mde-thesaurus');
const cached = join(cache, 'en.thes');
if (!existsSync(cached) || statSync(cached).mtimeMs < statSync(thesaurusScript).mtimeMs) execFileSync(process.execPath, [thesaurusScript, cached], { stdio: 'inherit' });
await cp(cache, join(app, 'thesaurus'), { recursive: true });

async function list(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await list(p)));
    else if (e.isFile() && e.name !== '.DS_Store') out.push({ path: relative(app, p).split('\\').join('/'), size: (await stat(p)).size });
  }
  return out;
}
await writeFile(join(dist, 'app', 'app-files.json'), `${JSON.stringify({ files: await list(app) })}\n`);
await writeFile(join(dist, 'version.json'), `${JSON.stringify({ version }, null, 2)}\n`);
console.log(`Built apps/web/dist (Folio Dome ${version})`);
