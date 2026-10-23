import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { buildDocumentCss, builtinVariables, componentSpec, composeDocument, paths, splitAnnotations, splitFrontMatter, type ComponentSpec, type RenderRequest, type RenderResult, type ThemeInfo } from '@mde/core';
import { assetUrlFor } from './assets';
import { resolvesInside } from './fsutil';
import { pdfInfo } from './pdfInserts';
import type { LibraryService } from './library';
import { FALLBACK_THEME_CSS, type ThemeService } from './themes';

/** Folder of a theme's components (Jekyll's _includes). */
export const THEME_INCLUDES_DIR = 'includes';
/** Optional theme settings, e.g. { "pageIncludes": ["footer.html"] }. */
export const THEME_SETTINGS_FILE = 'theme.json';
const COMPONENT_NAME = /^[\w][\w.-]*\.html$/;

/** theme.json, or {} when it is missing or not a JSON object (a mistake in it should not stop documents from rendering). */
async function readThemeSettings(themeDir: string): Promise<{ pageIncludes?: unknown }> {
  try {
    const v: unknown = JSON.parse(await fs.readFile(join(themeDir, THEME_SETTINGS_FILE), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export class RenderService {
  constructor(
    private readonly library: LibraryService,
    private readonly themes: ThemeService,
    /** The app's built-in components (used when the theme has no file of that name). */
    private readonly componentsDir: string | null = null,
  ) {}

  /** A component file from the theme, else from the app; null when neither has it. */
  private async componentFile(theme: ThemeInfo | null, file: string): Promise<{ path: string; text: string } | null> {
    for (const dir of [theme ? join(theme.path, THEME_INCLUDES_DIR) : null, this.componentsDir]) {
      if (!dir) continue;
      const path = join(dir, file);
      const text = await fs.readFile(path, 'utf8').catch(() => null);
      if (text !== null) return { path, text };
    }
    return null;
  }

  /** The theme a document uses: its front matter's, else its project's, else the default. */
  private async themeFor(docPath: string, text: string | undefined, override?: string): Promise<ThemeInfo | null> {
    const projectRoot = this.library.projectFor(docPath);
    const meta = projectRoot ? await this.library.readMeta(projectRoot) : null;
    const rootText = text ?? (await fs.readFile(docPath, 'utf8').catch(() => ''));
    const fmTheme = splitFrontMatter(splitAnnotations(rootText).text).data.theme;
    const themeName = override ?? (typeof fmTheme === 'string' ? fmTheme : undefined) ?? meta?.theme;
    return this.themes.resolve(themeName, projectRoot);
  }

  /** Components a document can insert, with their fields (the Insert Component dialog). */
  async components(req: { docPath: string; text?: string }): Promise<{ theme: string | null; components: ComponentSpec[] }> {
    this.library.assertInside(req.docPath);
    const theme = await this.themeFor(req.docPath, typeof req.text === 'string' ? req.text : undefined);
    const settings = theme ? await readThemeSettings(theme.path) : {};
    const onEveryPage = new Set(Array.isArray(settings.pageIncludes) ? settings.pageIncludes.filter((n): n is string => typeof n === 'string') : []);
    const found = new Map<string, ComponentSpec>();
    for (const dir of [theme ? join(theme.path, THEME_INCLUDES_DIR) : null, this.componentsDir]) {
      if (!dir) continue;
      const names = await fs.readdir(dir).catch(() => [] as string[]);
      for (const name of names.sort()) {
        if (!COMPONENT_NAME.test(name) || found.has(name)) continue;
        const text = await fs.readFile(join(dir, name), 'utf8').catch(() => null);
        if (text === null) continue;
        const spec = componentSpec(name, text);
        // A theme's every-page components (theme.json) are not placed in the text.
        if (onEveryPage.has(name)) spec.page = true;
        found.set(name, spec);
      }
    }
    const components = [...found.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return { theme: theme?.name ?? null, components };
  }

  async render(req: RenderRequest): Promise<RenderResult> {
    this.library.assertInside(req.docPath);
    const projectRoot = this.library.projectFor(req.docPath);
    const ref = projectRoot ? this.library.refFor(projectRoot) : null;
    const meta = projectRoot ? await this.library.readMeta(projectRoot) : null;

    const baseScope = builtinVariables(new Date(), {
      ...(ref ? { project: ref.name } : {}),
      ...(ref?.collection ? { collection: ref.collection } : {}),
      filename: basename(req.docPath, extname(req.docPath)),
    });

    // The theme is chosen before composing: components come from it.
    const rootText = req.overrides?.[req.docPath] ?? (await fs.readFile(req.docPath, 'utf8').catch(() => ''));
    const fmTheme = splitFrontMatter(splitAnnotations(rootText).text).data.theme;
    const themeName = req.themeName ?? (typeof fmTheme === 'string' ? fmTheme : undefined) ?? meta?.theme;
    const theme = await this.themes.resolve(themeName, projectRoot);
    const settings = theme ? await readThemeSettings(theme.path) : {};
    const componentDeps: string[] = [];
    // Files a document uses must be in the library, also when a symbolic link points elsewhere.
    const libraryRoot = this.library.requireRoot();
    const inLibrary = (p: string) => resolvesInside(p, [libraryRoot]);

    const composed = await composeDocument(
      {
        readText: async (p) => {
          if (!(await inLibrary(p))) return null;
          try {
            return (await fs.readFile(p, 'utf8')).replace(/\r\n?/g, '\n');
          } catch {
            return null;
          }
        },
        exists: inLibrary,
        assetUrl: assetUrlFor,
        pdfInfo: async (p) => {
          const st = await fs.stat(p);
          return pdfInfo(p, st, async () => new Uint8Array(await fs.readFile(p)));
        },
        loadComponent: async (name) => {
          if (!COMPONENT_NAME.test(name)) return null;
          const f = await this.componentFile(theme, name);
          if (f) componentDeps.push(f.path);
          return f?.text ?? null;
        },
        themeUrl: (rel) => {
          if (!theme) return rel;
          const path = join(theme.path, rel);
          return paths.isInside(path, theme.path) ? assetUrlFor(path) : rel;
        },
      },
      {
        docPath: req.docPath,
        projectRoot: projectRoot ?? dirname(req.docPath),
        baseScope,
        overrides: req.overrides,
        pageIncludes: Array.isArray(settings.pageIncludes) ? settings.pageIncludes.filter((n): n is string => typeof n === 'string') : [],
      },
    );

    let themeCss = FALLBACK_THEME_CSS;
    if (req.themeCssOverride && theme && req.themeCssOverride.cssPath === theme.cssPath) themeCss = req.themeCssOverride.css;
    else if (theme) themeCss = await fs.readFile(theme.cssPath, 'utf8').catch(() => FALLBACK_THEME_CSS);

    // Each component used brings its stylesheet (includes/<name>.css), after the theme's.
    for (const name of composed.components) {
      const f = await this.componentFile(theme, name.replace(/\.html$/, '.css'));
      if (f) {
        themeCss += `\n/* ${name} */\n${f.text}`;
        componentDeps.push(f.path);
      }
    }

    const css = buildDocumentCss({
      themeCss,
      themeDir: theme?.path ?? dirname(req.docPath),
      rootScope: composed.rootScope,
      variableNames: composed.variableNames,
      assetUrl: assetUrlFor,
    });

    return {
      html: composed.html,
      css,
      title: composed.rootScope.title || basename(req.docPath, extname(req.docPath)),
      themeName: theme?.name ?? 'Default',
      themeCssPath: theme?.cssPath ?? null,
      warnings: composed.warnings,
      dependencies: [...composed.dependencies, ...componentDeps],
      variables: composed.rootScope,
    };
  }
}
