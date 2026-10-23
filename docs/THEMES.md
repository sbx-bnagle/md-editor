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

**Add Images…** (right-click a theme in the theme menu) copies image files (PNG, JPEG, GIF, SVG, WebP, AVIF) into the theme's `images` folder; use them as `url("images/logo.png")` in CSS, or `{{ "images/logo.png" | theme_url }}` in a component. The notice that follows has a **Copy CSS** button.

Fonts installed on the Mac can be used by name. The bundled themes use macOS system fonts (Iowan Old Style, Avenir Next, SF Mono).

**Add Fonts…** (right-click a theme in the theme menu) copies font files (WOFF2, WOFF, TTF, OTF) into the theme's `fonts` folder and adds an `@font-face` rule for each, with the family, weight and style read from the file (from the file name for WOFF2). Fonts packaged this way travel with the theme when it is exported, and are embedded in exported PDFs. Include only fonts whose licence allows copying them.

## Sharing themes

Right-click a theme in the theme menu and choose **Export…** to save it as a `.mdtheme` file: the theme folder (CSS, fonts, images, components) as a zip, with a small manifest. **Import theme…** in the same menu adds one to the library (as “Name 2” if the name is taken). A zip of a theme folder also imports.

Images travel with the theme when they are in its folder. An image the theme's CSS (or a component's CSS) takes from elsewhere in the library, such as `url("../../Collections/Brand/logo.svg")`, is copied into the package's `images` folder and the packaged CSS points at the copy; the theme in the library is not changed. Export lists images it could not include (outside the library, or not found) and images the theme refers to that are missing; import lists those the package lacks.

Export reports the fonts the theme names but does not include. Those show only on Macs where they are installed; elsewhere the next font in each list is used. The app does not copy installed fonts into packages, because their licences may not allow it.

## Elements to style

| Element | Notes |
| --- | --- |
| `h1`–`h6`, `p`, `ul`, `ol`, `blockquote`, `hr`, `table` | Standard markdown output. A table written without a header row has a `tbody` and no `thead` |
| `mark` | `==marked text==`; without a theme rule, browsers show it on a yellow background |
| `figure.mde-figure`, `figcaption` | Images from content blocks; caption from the block title |
| `table.mde-table`, `caption` | CSV content blocks |
| `figure.mde-code-block`, `pre.mde-code`, `.hljs-*` | Code files and fenced code (highlight.js classes) |
| `section.mde-include` | Wraps each included document; `data-src-file` holds its project-relative path |
| `.footnotes`, `.footnote-ref` | Footnotes |
| `.page-break` | `+++` on its own line (or `<div class="page-break"></div>`); the app's base styles start a new page after it in every theme, and a theme can restyle it |
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

## Components

Components are pieces of HTML a document can use, written like [Jekyll includes](https://jekyllrb.com/docs/includes/):

```markdown
{% include figure.html src="images/plan.png" caption="The site plan" size="half" align="right" %}
```

On a line of its own a component is a block; inside a paragraph it is inline. Quoted values are text; an unquoted word is a document variable if one has that name (`caption=title`), otherwise the word itself (`size=half`). A leading `/` in `src` means the document's folder, as in content blocks.

The app has two built-in components:

| Component | Parameters |
| --- | --- |
| `figure.html` | `src`, `alt` (default: the caption), `caption` (markdown allowed), `size` (full, wide, half, third, quarter, small), `align` (center, left, right; text flows beside left and right) |
| `footer.html` | A footer on every page with a logo, the title and page numbers. Turn it on with `page-includes: footer.html` in front matter; it reads the variables `footer` (default: the title) and `footer-logo` |

A theme adds components, or replaces the built-in ones, with files in its `includes` folder: `includes/name.html`, and optionally `includes/name.css`, which is added to the document's styles only when the component is used.

Templates use a subset of Liquid:

| Syntax | Meaning |
| --- | --- |
| `{{ include.caption }}` | A parameter |
| `{{ title }}` | A document variable |
| `{{ include.alt \| default: include.caption \| plain }}` | Filters: `default`, `markdownify` (inline markdown to HTML), `plain` (markdown to plain text), `raw`, `escape`, `upcase`, `downcase`, `strip`, `slugify`, `theme_url` (URL of a file in the theme folder), `lookup` (another file's front matter, below), and the list filters below |
| `{% if include.x %} … {% elsif … %} … {% else %} … {% endif %}` | Conditions; also `{% unless %}`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `contains`, `empty`, `blank`, `and`, `or` |
| `{% for tag in tags %} … {% else %} … {% endfor %}` | A loop over a list; the `else` part shows when the list is empty. See *Lists and loops* |
| `{% assign name = value \| filters %}` | A name for the rest of the template |
| `{% include other.html key="value" %}` | Another component |
| `{% comment %} … {% endcomment %}` | Notes for theme authors |
| `{%- … -%}`, `{{- … -}}` | A `-` removes the white space (and line breaks) before or after the tag |

Unlike Jekyll, output is HTML-escaped unless it comes from `markdownify` or `raw`, so parameter text is safe inside attributes. Images in components need alt text; the problems list reports those without it.

### Lists and loops

A list in front matter, written either way:

```yaml
tags:
  - news
  - updates
team:
  - name: Ada
    role: Lead
  - name: Grace
    role: Advisor
```

prints in documents as its items joined by commas (`{{tags}}` → `news, updates`), and in templates it is a list:

```liquid
<ul class="tags">
  {%- for tag in tags %}
  <li class="tag-{{ tag | slugify }}">{{ tag }}</li>
  {%- endfor %}
</ul>

{% for person in team %}{{ person.name }} ({{ person.role }}){% unless forloop.last %}, {% endunless %}{% endfor %}
```

- Loops: `{% for item in list limit:3 offset:1 reversed %}`, and ranges such as `{% for n in (1..5) %}`. Inside a loop, `forloop.index` (from 1), `forloop.index0`, `forloop.rindex`, `forloop.first`, `forloop.last` and `forloop.length`. Loops can be nested (`{% for skill in person.skills %}`). `break`, `continue` and `cycle` are not supported.
- On a list: `list.size`, `list.first`, `list.last`, `list.0` (an item by position from 0); on an item of a list of mappings: `item.field`.
- Filters for lists: `join: ", "` (default: a space), `split: ", "` (text into a list), `size`, `first`, `last`, `reverse`, `sort` (or `sort: "name"` for mappings), `uniq`. `slugify` makes text usable in a class name or link (`Café News` → `cafe-news`).
- Pass a list to another component with an unquoted name: `{% include tags.html items=tags %}`, then `{% for t in include.items %}`. Inside a loop, `{% include tag.html name=tag %}` passes the current item.
- A quoted parameter is text; make it a list with `split`: `{% assign parts = include.list | split: ", " %}`.
- A document included as a content block can set its own value: a list replaces the parent's list, and text replaces it with text (looping over text gives that one text).
- `{{ list }}` in a template prints the items joined by `, `, as in documents. Use `join` to choose the separator.

### Looking up other files

`lookup` reads the front matter of another file in the project, found by name. With a folder of
files that hold only front matter, one per plant, named by the plant's name as a slug:

```
Project/
  Plants/
    echinacea-purpurea.md     ---
                              common name: purple cone flower
                              soil: acidic
                              water: wet
                              ---
  main.md                     ---
                              plants:
                                - Echinacea Purpurea
                              ---
                              {% include plant-list.html plants=plants %}
```

the component `includes/plant-list.html` can show each plant's details:

```liquid
<table class="plants">
  {%- for name in include.plants %}
  {%- assign plant = name | lookup: "Plants" %}
  <tr><td>{{ plant["common name"] | default: name }}</td><td>{{ plant.soil }}</td><td>{{ plant.water }}</td></tr>
  {%- endfor %}
</table>
```

- `name | lookup: "Folder"` gives the front matter of `Folder/<name as a slug>.md` in the document's project. The slug is the name in lowercase with each run of other characters made a hyphen (`slugify`), so “Echinacea Purpurea”, “echinacea purpurea” and “Echinacea_purpurea” all find `echinacea-purpurea.md`. Name the files that way.
- The folder is relative to the project, and can be deeper (`lookup: "Data/Plants"`) or come from a parameter (`lookup: include.folder`); it cannot be outside the project.
- A name with no file gives nothing (use `default:`), and is listed in the problems before export.
- A list looks up each item: `{% assign details = plants | lookup: "Plants" %}`.
- Fields whose names are not one word are read with brackets: `plant["common name"]`, or `plant[key]` with a name assigned to `key`. Fields can be lists (`plant.zones | join: ", "`) and mappings.
- The preview redraws when a looked-up file changes, or appears.

### Components on every page

`page-includes` in front matter (a list, or `none`) names components shown on every page; a theme can set a default in `theme.json`:

```json
{ "pageIncludes": ["footer.html"] }
```

Each is wrapped in `<div class="mde-page-include mde-page-include-NAME" aria-hidden="true">` at the start of the document. Its CSS makes the wrapper a running element and places it in a margin box:

```css
.mde-page-include-footer { position: running(mdeFooter); }
@page { @bottom-center { content: element(mdeFooter); } }
/* Paged.js hides the margin box's children with a rule of its own; style the copy with a more specific selector. */
.pagedjs_page .pagedjs_margin .pagedjs_margin-content > .mde-page-include.mde-page-include-footer { display: flex; }
```

Page-wide components are decoration for assistive technology, like page numbers: they are marked as artifacts in the PDF.

## Web pages

**Export Web Page…** (File menu, or a document's sidebar menu) writes one `.html` file with the theme's CSS, images and fonts embedded. `@page` rules and margin boxes do not apply on screen, and page-wide components are left out; a theme can add `@media screen { … }` rules for the web page.

## Project-specific changes

From the theme menu in the bottom bar, choose **Customize “Theme” for this project**. The theme is copied into the project (`.mdeditor/themes/`) and versioned with it; the library theme is unchanged.
