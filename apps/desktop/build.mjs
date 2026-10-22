// Bundles the main and preload scripts and assembles dist/ (renderer + library seed).
import { build } from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(here, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true, logLevel: 'warning' };
await build({ ...common, entryPoints: [join(here, 'src', 'main.ts')], outfile: join(dist, 'main.js') });
await build({ ...common, entryPoints: [join(here, 'src', 'preload.ts')], outfile: join(dist, 'preload.js') });

const uiDist = join(root, 'packages', 'ui', 'dist');
if (!existsSync(uiDist)) throw new Error('UI not built: run `npm run build -w @mde/ui` first.');
await cp(uiDist, join(dist, 'renderer'), { recursive: true });
await cp(join(root, 'resources', 'seed'), join(dist, 'seed'), { recursive: true });
// Themes kept out of the repository (resources/private/Themes, git-ignored) come with builds made on this machine.
const privateThemes = join(root, 'resources', 'private', 'Themes');
if (existsSync(privateThemes)) await cp(privateThemes, join(dist, 'seed', 'Themes'), { recursive: true });

// The thesaurus is generated from WordNet (wordnet-db) and cached between builds.
const thesaurusScript = join(root, 'scripts', 'build-thesaurus.mjs');
const cache = join(root, 'node_modules', '.cache', 'mde-thesaurus');
const cached = join(cache, 'en.thes');
if (!existsSync(cached) || statSync(cached).mtimeMs < statSync(thesaurusScript).mtimeMs) execFileSync(process.execPath, [thesaurusScript, cached], { stdio: 'inherit' });
await cp(cache, join(dist, 'thesaurus'), { recursive: true });
console.log('Built apps/desktop/dist');
