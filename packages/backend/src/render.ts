import { promises as fs } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { buildDocumentCss, builtinVariables, composeDocument, type RenderRequest, type RenderResult } from '@mde/core';
import { assetUrlFor } from './assets';
import { exists } from './fsutil';
import { pdfInfo } from './pdfInserts';
import type { LibraryService } from './library';
import { FALLBACK_THEME_CSS, type ThemeService } from './themes';

export class RenderService {
  constructor(
    private readonly library: LibraryService,
    private readonly themes: ThemeService,
  ) {}

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

    const composed = await composeDocument(
      {
        readText: async (p) => {
          try {
            return (await fs.readFile(p, 'utf8')).replace(/\r\n?/g, '\n');
          } catch {
            return null;
          }
        },
        exists,
        assetUrl: assetUrlFor,
        pdfInfo: async (p) => {
          const st = await fs.stat(p);
          return pdfInfo(p, st, async () => new Uint8Array(await fs.readFile(p)));
        },
      },
      { docPath: req.docPath, projectRoot: projectRoot ?? dirname(req.docPath), baseScope, overrides: req.overrides },
    );

    const themeName = req.themeName ?? composed.selection.theme ?? meta?.theme;
    const theme = await this.themes.resolve(themeName, projectRoot);
    let themeCss = FALLBACK_THEME_CSS;
    if (req.themeCssOverride && theme && req.themeCssOverride.cssPath === theme.cssPath) themeCss = req.themeCssOverride.css;
    else if (theme) themeCss = await fs.readFile(theme.cssPath, 'utf8').catch(() => FALLBACK_THEME_CSS);

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
      dependencies: composed.dependencies,
      variables: composed.rootScope,
    };
  }
}
