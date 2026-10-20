// Bundles the main and preload scripts and assembles dist/ (renderer + library seed).
import { build } from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
console.log('Built apps/desktop/dist');
