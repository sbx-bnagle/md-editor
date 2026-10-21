import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  DEFAULT_THEME,
  THEME_IMAGE_EXTENSIONS,
  cssImageRefs,
  familyFromFileName,
  fontFaceRule,
  paths,
  readFontInfo,
  rewriteCssImageRefs,
  templateImageRefs,
  themeFontReport,
  themeImageReport,
  themeRelative,
  type ThemeFontReport,
  type ThemeImageReport,
  LIBRARY_DIRS,
  META_DIR,
  PROJECT_THEMES_DIR,
  THEME_CSS,
  isHiddenName,
  validateName,
  type ThemeInfo,
} from '@mde/core';
import { atomicWrite, copyDir, exists, isDir, isFile, naturalCompare, uniqueName } from './fsutil';
import { UserError, type LibraryService } from './library';
import type { HostAdapter } from './host';

/** A theme package: the theme folder zipped, with a manifest. */
export const THEME_PACKAGE_EXT = 'mdtheme';
const MANIFEST = 'mdtheme.json';
const FONT_EXTENSIONS = ['woff2', 'woff', 'ttf', 'otf'];
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;

async function filesIn(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (isHiddenName(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await filesIn(p, base, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

const isThemeCss = (f: string) => f === THEME_CSS || (f.startsWith('includes/') && f.endsWith('.css'));
const isTemplate = (f: string) => f.startsWith('includes/') && f.endsWith('.html');

/** The theme's CSS plus its components' CSS, for the font report. */
async function themeCssText(dir: string, files: string[]): Promise<string> {
  return (await Promise.all(files.filter(isThemeCss).map((f) => fs.readFile(join(dir, f), 'utf8').catch(() => '')))).join('\n');
}

/** Images the theme's CSS and component templates refer to, given each file's text. */
function imageRefs(files: string[], text: (f: string) => string): string[] {
  return [...new Set(files.flatMap((f) => (isThemeCss(f) ? cssImageRefs(text(f)) : isTemplate(f) ? templateImageRefs(text(f)) : [])))];
}

async function imageReportFor(dir: string, files: string[]): Promise<ThemeImageReport> {
  const texts = new Map<string, string>();
  for (const f of files) if (isThemeCss(f) || isTemplate(f)) texts.set(f, await fs.readFile(join(dir, f), 'utf8').catch(() => ''));
  return themeImageReport(
    imageRefs(files, (f) => texts.get(f) ?? ''),
    files,
  );
}

/** Used when no theme can be found, so documents always render. */
export const FALLBACK_THEME_CSS = `@page { size: letter; margin: 1in; @bottom-center { content: counter(page); } }
body { font-family: Georgia, serif; font-size: 11pt; line-height: 1.5; }
`;

export class ThemeService {
  constructor(
    private readonly library: LibraryService,
    private readonly host: HostAdapter,
  ) {}

  private async scan(dir: string, scope: ThemeInfo['scope']): Promise<ThemeInfo[]> {
    if (!(await isDir(dir))) return [];
    const out: ThemeInfo[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || isHiddenName(e.name)) continue;
      const path = join(dir, e.name);
      const cssPath = join(path, THEME_CSS);
      if (await isFile(cssPath)) out.push({ name: e.name, path, cssPath, scope });
    }
    return out.sort((a, b) => naturalCompare(a.name, b.name));
  }

  libraryDir(): string {
    return join(this.library.requireRoot(), LIBRARY_DIRS.themes);
  }

  /** Library themes, plus project forks (which shadow library themes of the same name). */
  async list(projectPath?: string): Promise<ThemeInfo[]> {
    const lib = await this.scan(this.libraryDir(), 'library');
    if (!projectPath) return lib;
    const forks = await this.scan(join(projectPath, META_DIR, PROJECT_THEMES_DIR), 'project');
    const names = new Set(forks.map((f) => f.name));
    return [...forks, ...lib.filter((t) => !names.has(t.name))].sort((a, b) => naturalCompare(a.name, b.name));
  }

  async resolve(name: string | undefined, projectPath: string | null): Promise<ThemeInfo | null> {
    const all = await this.list(projectPath ?? undefined);
    return all.find((t) => t.name === (name ?? DEFAULT_THEME)) ?? all.find((t) => t.name === DEFAULT_THEME) ?? all[0] ?? null;
  }

  async create(name: string, from?: string): Promise<ThemeInfo> {
    const err = validateName(name);
    if (err) throw new UserError(err);
    const dest = join(this.libraryDir(), name);
    if (await exists(dest)) throw new UserError(`A theme named “${name}” already exists.`);
    if (from) {
      const src = (await this.list()).find((t) => t.name === from);
      if (!src) throw new UserError(`Theme “${from}” not found.`);
      await copyDir(src.path, dest);
    } else {
      await fs.mkdir(dest, { recursive: true });
      await fs.writeFile(join(dest, THEME_CSS), FALLBACK_THEME_CSS);
    }
    this.host.emit({ type: 'library-changed' });
    return { name, path: dest, cssPath: join(dest, THEME_CSS), scope: 'library' };
  }

  async fork(projectPath: string, themeName: string): Promise<ThemeInfo> {
    this.library.assertInside(projectPath);
    const src = (await this.list()).find((t) => t.name === themeName);
    if (!src) throw new UserError(`Theme “${themeName}” not found.`);
    const dest = join(projectPath, META_DIR, PROJECT_THEMES_DIR, themeName);
    if (!(await exists(dest))) await copyDir(src.path, dest);
    this.host.emit({ type: 'library-changed' });
    return { name: themeName, path: dest, cssPath: join(dest, THEME_CSS), scope: 'project' };
  }

  private async libraryTheme(name: string): Promise<ThemeInfo> {
    const t = (await this.list()).find((x) => x.name === name);
    if (!t) throw new UserError(`Theme “${name}” not found.`);
    return t;
  }

  /** Fonts the theme packages, uses by name only, or names but lacks. */
  async fontReport(name: string): Promise<ThemeFontReport> {
    const t = await this.libraryTheme(name);
    const files = await filesIn(t.path);
    return themeFontReport(await themeCssText(t.path, files), files);
  }

  /**
   * Writes a .mdtheme package (the theme folder zipped). Images the theme's CSS takes from
   * elsewhere in the library are copied into the package's images folder, and the packaged CSS
   * points there. Null when the save dialog is cancelled.
   */
  async exportTheme(name: string, outPath?: string): Promise<{ path: string; fonts: ThemeFontReport; images: ThemeImageReport } | null> {
    const t = await this.libraryTheme(name);
    const out =
      outPath ?? (await this.host.chooseSavePath({ title: 'Export Theme', defaultPath: join(homedir(), 'Desktop', `${name}.${THEME_PACKAGE_EXT}`), extensions: [THEME_PACKAGE_EXT] }));
    if (!out) return null;
    const files = await filesIn(t.path);
    const fonts = themeFontReport(await themeCssText(t.path, files), files);
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f] = new Uint8Array(await fs.readFile(join(t.path, f)));

    const root = this.library.requireRoot();
    const bySource = new Map<string, string>();
    const copied: string[] = [];
    for (const f of files.filter(isThemeCss)) {
      const css = strFromU8(entries[f]);
      const moved = new Map<string, string>();
      for (const ref of cssImageRefs(css)) {
        const rel = themeRelative(ref);
        if (rel !== '..' && !rel.startsWith('../')) continue;
        const src = resolve(t.path, rel);
        if (!paths.isInside(src, root) || !(await isFile(src))) continue;
        let target = bySource.get(src);
        if (!target) {
          target = packagePath(entries, 'images', basename(src));
          entries[target] = new Uint8Array(await fs.readFile(src));
          bySource.set(src, target);
        }
        moved.set(ref, target);
        if (!copied.includes(ref)) copied.push(ref);
      }
      if (moved.size) entries[f] = strToU8(rewriteCssImageRefs(css, (ref) => moved.get(ref) ?? null));
    }
    const packaged = Object.keys(entries);
    const images = {
      ...themeImageReport(
        imageRefs(packaged, (f) => strFromU8(entries[f])),
        packaged,
      ),
      copied,
    };

    entries[MANIFEST] = strToU8(JSON.stringify({ format: 1, name, fontsByName: fonts.byName }, null, 2));
    await fs.mkdir(dirname(out), { recursive: true });
    await atomicWrite(out, zipSync(entries, { level: 6 }));
    return { path: out, fonts, images };
  }

  /** Adds a theme from a .mdtheme package (asks for the file when `source` is not given). */
  async importTheme(source?: string): Promise<{ theme: ThemeInfo; fonts: ThemeFontReport; images: ThemeImageReport } | null> {
    const file = source ?? (await this.host.chooseFiles('Import Theme', [THEME_PACKAGE_EXT, 'zip']))[0];
    if (!file) return null;
    const st = await fs.stat(file);
    if (st.size > MAX_PACKAGE_BYTES) throw new UserError('This theme package is larger than 100 MB.');
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await fs.readFile(file)));
    } catch {
      throw new UserError(`“${basename(file)}” is not a theme package.`);
    }
    for (const n of Object.keys(entries)) {
      if (n.startsWith('/') || n.includes('\\') || n.split('/').some((p) => p === '..')) throw new UserError(`“${basename(file)}” contains an unsafe path (${n}).`);
    }
    // A package made by zipping the theme folder itself has one top folder; use what is inside it.
    let names = Object.keys(entries).filter((n) => !n.endsWith('/') && !n.split('/').some((p) => isHiddenName(p) || p === '__MACOSX'));
    const tops = new Set(names.map((n) => n.split('/')[0]));
    let prefix = '';
    if (!names.includes(THEME_CSS) && tops.size === 1 && names.some((n) => n.endsWith(`/${THEME_CSS}`))) prefix = `${[...tops][0]}/`;
    names = names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length));
    if (!names.includes(THEME_CSS)) throw new UserError(`“${basename(file)}” has no ${THEME_CSS}, so it is not a theme package.`);
    let manifest: { name?: unknown } = {};
    try {
      manifest = entries[`${prefix}${MANIFEST}`] ? JSON.parse(strFromU8(entries[`${prefix}${MANIFEST}`])) : {};
    } catch {
      manifest = {};
    }
    const wanted = (typeof manifest.name === 'string' && manifest.name.trim()) || basename(file, extname(file));
    const name = validateName(wanted) ? 'Imported theme' : wanted;
    const dir = this.libraryDir();
    const dest = join(dir, await uniqueName(dir, name));
    for (const n of names) {
      if (n === MANIFEST) continue;
      const target = join(dest, n);
      if (!target.startsWith(dest + sep)) throw new UserError(`“${basename(file)}” contains an unsafe path (${n}).`);
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(target, entries[`${prefix}${n}`]);
    }
    this.host.emit({ type: 'library-changed' });
    const theme: ThemeInfo = { name: basename(dest), path: dest, cssPath: join(dest, THEME_CSS), scope: 'library' };
    const files = await filesIn(dest);
    return { theme, fonts: themeFontReport(await themeCssText(dest, files), files), images: await imageReportFor(dest, files) };
  }

  /**
   * Copies font files into the theme's fonts folder and adds @font-face rules for them to its
   * CSS, so the fonts travel with the theme. Returns the font families added.
   */
  async addFonts(name: string, sources?: string[]): Promise<string[]> {
    const t = await this.libraryTheme(name);
    const files = sources ?? (await this.host.chooseFiles('Add Fonts to the Theme', FONT_EXTENSIONS));
    if (!files.length) return [];
    const fontsDir = join(t.path, 'fonts');
    await fs.mkdir(fontsDir, { recursive: true });
    const rules: string[] = [];
    const families = new Set<string>();
    for (const src of files) {
      const ext = extname(src).slice(1).toLowerCase();
      if (!FONT_EXTENSIONS.includes(ext)) throw new UserError(`“${basename(src)}” is not a font file (WOFF2, WOFF, TTF or OTF).`);
      const bytes = new Uint8Array(await fs.readFile(src));
      const target = await uniqueName(fontsDir, basename(src, extname(src)), extname(src));
      await fs.writeFile(join(fontsDir, target), bytes);
      const info = readFontInfo(bytes) ?? familyFromFileName(basename(src));
      families.add(info.family);
      rules.push(fontFaceRule(`fonts/${target}`, info));
    }
    // After any leading comments, @charset and @import rules, which must stay first.
    const css = await fs.readFile(t.cssPath, 'utf8');
    const head = /^(?:\s*(?:\/\*[\s\S]*?\*\/|@charset[^;]*;|@import[^;]*;))*/.exec(css)![0];
    await atomicWrite(t.cssPath, `${head}${head ? '\n\n' : ''}${rules.join('\n')}\n${css.slice(head.length).replace(/^\s*\n/, '')}`);
    this.host.emit({ type: 'files-changed', paths: [t.cssPath] });
    return [...families];
  }

  /** Copies image files into the theme's images folder; returns their paths relative to the theme. */
  async addImages(name: string, sources?: string[]): Promise<string[]> {
    const t = await this.libraryTheme(name);
    const files = sources ?? (await this.host.chooseFiles('Add Images to the Theme', THEME_IMAGE_EXTENSIONS));
    for (const src of files) {
      if (!THEME_IMAGE_EXTENSIONS.includes(extname(src).slice(1).toLowerCase())) throw new UserError(`“${basename(src)}” is not an image (PNG, JPEG, GIF, SVG, WebP or AVIF).`);
    }
    if (!files.length) return [];
    const dir = join(t.path, 'images');
    await fs.mkdir(dir, { recursive: true });
    const added: string[] = [];
    for (const src of files) {
      const target = await uniqueName(dir, basename(src, extname(src)), extname(src));
      await fs.copyFile(src, join(dir, target));
      added.push(`images/${target}`);
    }
    this.host.emit({ type: 'library-changed' });
    return added;
  }
}

/** A path for a file added to a package, `dir/name`, numbered if the package already has one. */
function packagePath(entries: Record<string, Uint8Array>, dir: string, name: string): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  let candidate = `${dir}/${name}`;
  for (let n = 2; candidate.toLowerCase() in lowerKeys(entries); n++) candidate = `${dir}/${stem} ${n}${ext}`;
  return candidate;
}

function lowerKeys(entries: Record<string, Uint8Array>): Record<string, true> {
  return Object.fromEntries(Object.keys(entries).map((k) => [k.toLowerCase(), true]));
}
