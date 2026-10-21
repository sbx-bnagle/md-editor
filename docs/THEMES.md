# Writing themes

A theme is a folder in `Library/Themes/` containing `theme.css`. Open it from the theme menu in the bottom bar (**Edit theme**); press ⌘R to preview it with the last markdown document you opened. **New theme…** in the same menu creates one; right-click a theme there to duplicate, rename or remove it.

Themes use [CSS Paged Media](https://www.w3.org/TR/css-page-3/), laid out by Paged.js in both the preview and the PDF.

## Page size and margins

```css
@page {
  size: letter;            /* or A4, or 6in 9in */
  margin: 1in 1in 0.9in;
}
```

## Fixed areas (headers and footers)

The sixteen `@page` margin boxes (`@top-left`, `@top-center`, `@top-right`, `@bottom-left`, …) hold running content.

```css
@page {
  @top-left     { content: var(--title); }
  @top-right    { content: var(--section); }
  @bottom-left  { content: var(--date); }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); }
}
@page :first {
  @top-left  { content: none; }
  @top-right { content: none; }
}
```

## Using document variables

Every front matter value is available as a CSS custom property: `title` → `var(--title)`, `Client Name` → `var(--Client-Name)`, `client.name` → `var(--client-name)`.

- **In margin boxes**, `var(--name)` follows the document structure: when an included document sets its own value, pages showing that document's content use it. (The app rewrites these to `string()` with `string-set` markers.)
- **Elsewhere**, `var(--name)` is the exported document's value.
- Values are strings, so use them in `content`, not as colours or lengths.
- A fallback works as usual: `var(--title, var(--project))`.

## Fonts and images

Relative `url()` references resolve from the theme folder:

```css
@font-face { font-family: "Brand"; src: url("fonts/Brand-Regular.woff2"); }
@page { @top-left { content: url("logo.svg"); } }
```

Fonts installed on the Mac can be used by name. The bundled themes use macOS system fonts (Iowan Old Style, Avenir Next, SF Mono).

## Elements to style

| Element | Notes |
| --- | --- |
| `h1`–`h6`, `p`, `ul`, `ol`, `blockquote`, `hr`, `table` | Standard markdown output |
| `figure.mde-figure`, `figcaption` | Images from content blocks; caption from the block title |
| `table.mde-table`, `caption` | CSV content blocks |
| `figure.mde-code-block`, `pre.mde-code`, `.hljs-*` | Code files and fenced code (highlight.js classes) |
| `section.mde-include` | Wraps each included document; `data-src-file` holds its project-relative path |
| `.footnotes`, `.footnote-ref` | Footnotes |
| `.page-break` | `<div class="page-break"></div>` forces a new page in the bundled themes |
| `.mde-missing` | Box shown for missing or unsupported content blocks |
| `figure.mde-diagram`, `.mde-mermaid svg` | Mermaid diagrams (see below) |

## Diagrams

Mermaid diagrams are drawn with the theme's paragraph font and about 90% of its size, at the width of the page's text area. Custom properties adjust them:

```css
:root {
  --diagram-font: "Avenir Next", sans-serif;  /* default: the font of p */
  --diagram-font-size: 12px;                   /* default: 90% of the p font size */
  --diagram-theme: neutral;                    /* Mermaid theme: neutral, default, base, forest, dark */
}
```

A diagram is never split across pages: if it does not fit, it moves to the next page.

## Project-specific changes

From the theme menu in the bottom bar, choose **Customize “Theme” for this project**. The theme is copied into the project (`.mdeditor/themes/`) and versioned with it; the library theme is unchanged.
