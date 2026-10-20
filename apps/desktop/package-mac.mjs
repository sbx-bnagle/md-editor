// Packages MD Editor.app for Apple Silicon. Runs on macOS or Linux; the result is unsigned.
// On a Mac, sign ad hoc afterwards (required on Apple Silicon for apps not built by Xcode):
//   codesign --force --deep --sign - "out/MD Editor-darwin-arm64/MD Editor.app"
import { packager } from '@electron/packager';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(await readFile(join(here, '..', '..', 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const stage = join(here, 'out', 'stage');
await rm(join(here, 'out'), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(here, 'dist'), join(stage, 'dist'), { recursive: true, filter: (src) => !src.includes(`${join('dist', 'seed')}`) });
await writeFile(
  join(stage, 'package.json'),
  JSON.stringify({ name: 'md-editor', productName: pkg.productName, version: pkg.version, main: 'dist/main.js' }, null, 2),
);

const paths = await packager({
  dir: stage,
  out: join(here, 'out'),
  name: pkg.productName,
  // Placeholder; replace with a reverse-DNS id you own before distributing.
  appBundleId: 'local.mdeditor.app',
  appCategoryType: 'public.app-category.productivity',
  appVersion: pkg.version,
  platform: 'darwin',
  arch: 'arm64',
  electronVersion,
  asar: true,
  prune: false,
  overwrite: true,
  extraResource: [join(here, 'dist', 'seed')],
  darwinDarkModeSupport: true,
});
console.log(paths.join('\n'));
