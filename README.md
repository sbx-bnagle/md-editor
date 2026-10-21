# MD Editor

A macOS markdown editor with a project library and themed PDF export.

- **Library** of plain Finder folders: collections → projects → any folders inside a project. Templates are project folders copied into new projects.
- **Workspace** with a markdown editor and a paged, themed preview (toggle with ⌘R): running headers and footers, page numbers, US Letter by default.
- **Content blocks** (transclusion) in iA Writer's syntax: a line that is only a path, such as `/chapters/intro.md` or `../data/sales.csv "Caption"`.
- **Variables** from YAML front matter, usable as `{{name}}` in markdown and `var(--name)` in theme CSS. Included documents inherit them and can override them locally; headers and footers follow the section on each page.
- **Themes** are CSS files (CSS Paged Media), editable in the app. A project can customise a copy of a library theme.
- **Version history** per project, stored in one file: automatic snapshots after edits pause, named checkpoints, diffs, restore.
- **Export** a document to PDF, or a project folder to ZIP.
- Curly quotes and dashes as you type (`--` en dash, `---` em dash), kept straight inside HTML tags, code, variables, front matter and content block lines.
- **AI**: Claude or any OpenAI-compatible service (OpenAI, OpenRouter, Ollama, LM Studio). ⌘K writes at the cursor or rewrites a selection; the Assistant panel holds a conversation about the document. AI-written text is recorded and shown dimmed (toggle with ⇧⌘A).
- **Voice and style guides**: voice guides in prose for the AI, style guides with rules on an unofficial AP-like, Chicago-like or Oxford-like base. See [docs/STYLE-GUIDES.md](docs/STYLE-GUIDES.md).
- **Checks**: spelling (macOS), grammar (Harper, offline), style rules, AI review, and readability highlighting, as underlines with suggested fixes.
- **Insights**: readability grades (Flesch–Kincaid and others), headline clarity and engagement scores with AI alternatives.
- **Thesaurus**: right-click (or Control-click) selected text for synonyms in the same form (walked → strolled), offline, from WordNet.
- **Diagrams**: Mermaid flowcharts, Gantt charts, timelines and more, as ```` ```mermaid ```` blocks or `.mmd` content blocks, drawn in the theme's font.
- **Accessible PDF**: tagged for screen readers and checked with veraPDF against PDF/UA-1; the app warns about missing image and diagram descriptions and skipped heading levels before export. See [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

Status: iteration 3 in progress. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- macOS 13 or later on Apple Silicon (from the packaged Electron 44 `Info.plist`).
- To build: Node.js 22 and npm.

## Run from source

```sh
npm install
npm start            # builds the UI and the Electron app, then launches it
```

On first launch the app offers to create a library at `~/Documents/MD Editor Library`, seeded with two themes, a Report template, sample voice and style guides, and a Feature Tour project.

The sidebar lists collections and projects. Themes and voice and style guides are chosen, edited and created from their menus in the bottom bar; collections, projects and templates from the **+** menu (**New Collection…**, **New Project…**, **New Project from Template…**, **New Template from Project…**).

To use the AI, open Settings (⌘,) › AI, paste an API key, and choose a model. Keys are encrypted with the macOS Keychain and never reach the interface.

## Build the app

```sh
npm run dist:mac     # -> apps/desktop/out/MD Editor-darwin-arm64/MD Editor.app
```

The app is not signed with an Apple Developer ID. On Apple Silicon it needs at least an ad-hoc signature. After building on a Mac:

```sh
codesign --force --deep --sign - "apps/desktop/out/MD Editor-darwin-arm64/MD Editor.app"
```

A downloaded copy is quarantined by Gatekeeper; clear it with `xattr -cr "MD Editor.app"`, or Control-click the app and choose Open.

## Develop

```sh
npm run check        # layer boundaries + type checks + unit tests
npm test             # unit and integration tests (vitest)
npm run build && node apps/desktop/e2e/smoke.mjs     # end-to-end tests (Linux: prefix with xvfb-run -a)
node apps/desktop/e2e/writing.mjs                   # AI, checking and thesaurus, against a local mock AI
node apps/desktop/e2e/pdf.mjs                       # PDF tags and diagrams; set VERAPDF to validate with veraPDF
```

Code layout and the rules that keep it portable are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). File formats are in [docs/FILE-FORMATS.md](docs/FILE-FORMATS.md); theme authoring in [docs/THEMES.md](docs/THEMES.md); accessibility in [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).
