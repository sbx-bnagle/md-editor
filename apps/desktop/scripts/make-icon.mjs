// Renders resources/icon/icon.svg at every size a macOS icon needs and writes
// resources/icon/icon.icns (PNG entries) and icon-1024.png. Run after changing the SVG:
//   npx electron apps/desktop/scripts/make-icon.mjs          (Linux: xvfb-run -a … --no-sandbox)
import { BrowserWindow, app } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = join(root, 'resources', 'icon');

// ICNS entry types for PNG data, with their pixel sizes (the @2x types are Retina versions).
const ENTRIES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
];

/** The SVG drawn at `size` pixels, with a transparent background (offscreen, at scale 1). */
async function render(svg, size) {
  const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body>${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`;
  const file = join(tmpdir(), `folio-icon-${size}.html`);
  await writeFile(file, html);
  await win.loadFile(file);
  await rm(file, { force: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage();
  win.destroy();
  const { width } = image.getSize();
  return (width === size ? image : image.resize({ width: size, height: size, quality: 'best' })).toPNG();
}

async function main() {
  const svg = await readFile(join(dir, 'icon.svg'), 'utf8');
  const pngs = new Map();
  for (const size of new Set(ENTRIES.map(([, s]) => s))) pngs.set(size, await render(svg, size));
  const chunks = ENTRIES.map(([type, size]) => {
    const data = pngs.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'latin1');
  header.writeUInt32BE(8 + body.length, 4);
  await writeFile(join(dir, 'icon.icns'), Buffer.concat([header, body]));
  await writeFile(join(dir, 'icon-1024.png'), pngs.get(1024));
  console.log(`Wrote ${join(dir, 'icon.icns')} (${ENTRIES.length} sizes) and icon-1024.png`);
}

app.disableHardwareAcceleration();
// One window per size: the app stays open between them.
app.on('window-all-closed', () => undefined);
// Not a top-level await: Electron is not ready until this module has finished loading.
app
  .whenReady()
  .then(main)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
