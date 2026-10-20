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

Status: iteration 2 of 3. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- macOS 13 or later on Apple Silicon (from the packaged Electron 44 `Info.plist`).
- To build: Node.js 22 and npm.

## Run from source

```sh
npm install
npm start            # builds the UI and the Electron app, then launches it
```

On first launch the app offers to create a library at `~/Documents/MD Editor Library`, seeded with two themes, a Report template, sample voice and style guides, and a Feature Tour project.

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
node apps/desktop/e2e/writing.mjs                   # AI and checking features, against a local mock AI
```

Code layout and the rules that keep it portable are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). File formats are in [docs/FILE-FORMATS.md](docs/FILE-FORMATS.md); theme authoring in [docs/THEMES.md](docs/THEMES.md).
