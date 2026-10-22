# MD Editor

A macOS markdown editor with a project library and themed PDF export.

- **Library** of plain Finder folders: collections → projects → any folders inside a project. Templates are project folders copied into new projects.
- **Workspace** with a markdown editor and a paged, themed preview (toggle with ⌘R): running headers and footers, page numbers, US Letter by default. ⌘E hides or shows the library.
- **Tabs**: a click in the library opens the file in the current tab; ⌘-click or right-click › Open in New Tab opens it in another. ⌘T opens an empty tab, ⌘N (or + in the tab bar) a new file in a new tab, ⌘W closes a tab; ⌃Tab and ⇧⌘] / ⇧⌘[ switch tabs. Each tab keeps its undo history, and the tabs come back at the next launch.
- **Formatting keys**: ⌘B bold (`**`), ⌘I italic (`*`), ⌘M marked (`==text==`, highlighted). Each toggles the markers around the selection, or around the word at the cursor.
- **Find and replace** (⌘F) with Replace All (⌥⌘Return); ⇧⌘L selects every occurrence of the selected text and ⌘D adds the next one, so typing replaces them all.
- **Content blocks** (transclusion) in iA Writer's syntax: a line that is only a path, such as `/chapters/intro.md` or `../data/sales.csv "Caption"`.
- **Variables** from YAML front matter, usable as `{{name}}` in markdown and `var(--name)` in theme CSS. Included documents inherit them and can override them locally; headers and footers follow the section on each page.
- **Themes** are CSS files (CSS Paged Media), editable in the app. A project can customise a copy of a library theme.
- **Version history** per project, stored in one file: automatic snapshots after edits pause, named checkpoints, diffs, restore.
- **Export** a document to PDF or a single web page, or a project folder to ZIP.
- **Tables** in the editor stay one line per row: rows are cut off at the edge of the text column and the table scrolls sideways as a whole (trackpad, Shift-scroll or the scroll bar under its last row), following the cursor.
- Curly quotes and dashes as you type (`--` en dash, `---` em dash), kept straight inside HTML tags, code, variables, front matter and content block lines. Hyphens in table rows (any line with a `|`) are left as typed.
- **AI**: Claude or any OpenAI-compatible service (OpenAI, OpenRouter, Ollama, LM Studio). ⌘K writes at the cursor or rewrites a selection; the Assistant panel holds a conversation per project, saved with the project and there at the next launch. AI-written text is recorded and shown dimmed (toggle with ⇧⌘A).
- **Voice and style guides**: voice guides in prose for the AI, style guides with rules on an unofficial AP-like, Chicago-like or Oxford-like base. See [docs/STYLE-GUIDES.md](docs/STYLE-GUIDES.md).
- **Checks**: spelling (macOS), grammar (Harper, offline), style rules, AI review, and readability highlighting, as underlines with suggested fixes.
- **Insights**: readability grades (Flesch–Kincaid and others), headline clarity and engagement scores with AI alternatives.
- **Thesaurus**: right-click (or Control-click) selected text for synonyms in the same form (walked → strolled), offline, from WordNet.
- **Diagrams**: Mermaid flowcharts, Gantt charts, timelines and more, as ```` ```mermaid ```` blocks or `.mmd` content blocks, drawn in the theme's font.
- **Accessible PDF**: tagged for screen readers and checked with veraPDF against PDF/UA-1; the app warns about missing image and diagram descriptions and skipped heading levels before export. See [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).
- **AI reference files**: add an RFP, addenda or a brief to a project and tick the files the AI should read; the Assistant, ⌘K and Review with AI use them, and the review lists requirements the document does not address.
- **PDF pages in exports**: a content block such as `/forms/W-9.pdf#pages=3,1-2 "Form W-9"` puts those pages into the PDF; pick pages from thumbnails, and arrange PDFs before and after the document in the Export PDF dialog.
- **Edit in the preview**: double-click a paragraph, heading or list item in the preview to change its text; the change is written back to the markdown. Editor and preview keep their place when you switch between them.
- **History** keeps named versions, thins automatic ones by age, merges copies of the history file made by sync services, and covers the library's themes and guides.
- **Library search** at the bottom of the sidebar (⇧⌘F) finds collections, projects, folders and files by name, and files by their text, with the matching lines.
- **Finder tags**: right-click a file, folder or project for coloured tags, shown as dots after the name and stored as real Finder tags.
- **Theme components** written like Jekyll includes: `{% include figure.html src="plan.png" caption="Site plan" size="half" %}`, and components on every page such as a footer. See [docs/THEMES.md](docs/THEMES.md).
- **Theme packages**: export and import themes as `.mdtheme` files, with their fonts and images (Add Fonts… and Add Images… copy files into a theme).
- **Web page export**: one self-contained `.html` file.
- Right-click in the editor for **Ask AI** (on a selection), HTML entities, the emoji picker and inline images sized to the text.

Status: iteration 5.3 done. A manual test checklist is in [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md). See [docs/ROADMAP.md](docs/ROADMAP.md).

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
node apps/desktop/e2e/pdf.mjs                       # PDF tags, diagrams and inserted pages; set VERAPDF to validate with veraPDF
```

Code layout and the rules that keep it portable are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). File formats are in [docs/FILE-FORMATS.md](docs/FILE-FORMATS.md); theme authoring in [docs/THEMES.md](docs/THEMES.md); accessibility in [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).
