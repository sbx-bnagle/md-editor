# Architecture

The app is split into layers so the UI and document logic can move to another shell (Tauri, a native app hosting a JS engine, a web app) by replacing only the host layer.

```
packages/core      Platform-independent logic. TypeScript only: no Node, DOM, or Electron APIs.
                   Markdown pipeline, content blocks, variables, curly quotes and dashes,
                   authorship annotations, history file format, diffs, theme CSS processing,
                   style rules, readability, headline heuristics, AI prompts, preferences,
                   thesaurus lookups, diagram placeholders, PDF artifact marking, PDF page
                   selections, preview edit mapping, history pruning, theme components
                   (Liquid subset), library search matching, Finder tag encoding, theme fonts,
                   and the AppApi contract (src/api.ts).
packages/backend   Node.js services implementing AppApi (library, documents, themes, render,
                   history, export with PDF inserts and the PDF accessibility pass, guides,
                   AI providers, AI reference files, thesaurus, file watcher). No Electron or DOM
                   APIs. Needs a HostAdapter (src/host.ts) for Trash, Finder, dialogs, PDF
                   printing, events and encrypted secrets.
packages/ui        React UI. Uses core for pure functions and talks to the host only through
                   AppApi, built on a small transport (src/api/host.ts). No Node or Electron APIs.
apps/desktop       Electron host: main process, preload bridge, menus, protocols, PDF printing.
apps/web           Web app for tablets and phones: the backend bundled for the browser, with
                   Node's fs, path, os and crypto replaced by stand-ins (src/shims) over a virtual
                   file system whose library is in Dropbox or Google Drive; see "Web app" below
                   and WEB.md.
resources/seed     Themes, templates and an example project copied into a new library.
scripts            Layer boundary check; thesaurus data builder (WordNet → dist/thesaurus/en.thes).
```

## Rules

- `npm run check:boundaries` fails when a layer imports something it should not (`scripts/check-boundaries.mjs`).
- Each package's `tsconfig.json` limits ambient types: core has neither DOM nor Node types; ui has DOM only; backend has Node only.
- Every AppApi method is async and takes and returns plain serializable data, so any transport (IPC, HTTP, a native bridge) can carry it.
- The backend validates that every path from the UI is inside the open library.
- Links in the preview do not navigate it: `#anchors` scroll, web links open in the browser with ⌘-click, and the main process blocks any frame from leaving the app's pages.

## Porting

| To | Keep | Replace |
| --- | --- | --- |
| Web (done: apps/web) | core, ui, backend (in the page) | Node's modules → stand-ins over a virtual file system synced with Dropbox or Google Drive; apps/desktop → a host script |
| Tauri | core, ui, backend (as a Node sidecar) | apps/desktop → Tauri shell implementing the transport and HostAdapter |
| Native macOS (Swift) | ui in a WKWebView; core in JavaScriptCore | backend → Swift services implementing AppApi |

## Web app

The web app runs the UI and the backend in one page. `apps/web/build.mjs` bundles `src/main.ts`
with the backend for the browser, with `node:fs`, `node:path`, `node:os` and `node:crypto` aliased
to `src/shims`, and puts it before the UI's script in `index.html`. It sets `window.mdeHost`, so the
UI is the same; values are copied between the two (`structuredClone`) as they are over Electron's
IPC. The UI checks `isWeb` (platform `web`) for what differs: no Finder tags, the menu (☰) button,
the library drawer on narrow screens, the sync state in the bottom bar.

The file system (`src/vfs`) has three mounts, each a tree kept in memory (`tree.ts`):

- `/app`: the app's own files (seed library, components, thesaurus), listed in `app-files.json` at
  build time and fetched when first read;
- `/local`: this browser's files in IndexedDB (settings, imports, exports on their way out);
- `/Dropbox/…` or `/Google Drive/…`: the library (`remote.ts`). Its tree is saved in IndexedDB with
  the service's change cursor; file contents are downloaded when first read and cached. Changes go
  into a queue (also in IndexedDB) and are sent in order; uploads say which revision they were
  edited from, and the service saves a conflicted copy when the file changed elsewhere. A
  temporary file renamed over a real one (the backend's safe-write pattern) is sent as one upload.
  Changes made elsewhere are fetched with the cursor and reported through `fs.watch`, so the
  backend's watcher works as on the Mac.

Providers (`src/storage`) implement the calls the mount needs (`vfs/provider.ts`): Dropbox's HTTP
API with PKCE sign-in and refresh tokens; Google Drive's API with an access token from a pop-up and
an index of ids by path (Drive keeps files by id). The setup (`storage/setup.ts`) chooses the
service and the library folder.

The host (`src/main.ts`) gives the backend Trash (the service's trash), downloads instead of save
dialogs, file choosers in a small dialog (browsers open them only from a click), the AI keys kept
with the storage account, and `fetch`. Asset URLs (`setAssetPrefix`) point at `<app>/__asset/…`,
which the service worker (`src/sw.ts`) serves by asking the page for the file. PDF export lays the
document out in `print.html` in a frame and opens the browser's print dialog (`src/print.ts`).

`apps/web/e2e/web.mjs` runs the app in Chromium at phone and tablet sizes against stand-ins for
Dropbox (`mockDropbox.mjs`) and Google Drive (`mockDrive.mjs`).

## Data flow

1. The UI calls `api.render.document({ docPath, overrides })`. Unsaved editor text is passed as an override.
2. The backend reads files, and core composes the document: front matter → variables → content blocks (recursively, each file with its own scope) → markdown-it → HTML with hidden scope markers.
3. Core builds the stylesheet: base CSS + theme CSS (relative URLs resolved, margin-box `var()` rewritten to `string()`) + variable rules.
4. The UI loads a fresh iframe (`preview.html`), draws Mermaid diagrams with the theme's font (`packages/ui/src/preview/diagrams.ts`) and lays the HTML out with Paged.js. PDF export runs the same layout in a hidden window (`print.html`) and calls Chromium's `printToPDF`, so preview and PDF use the same engine.
5. The backend post-processes the tagged PDF: inserted PDF pages replace their placeholders and arranged PDFs are added before and after the document (`pdfInserts.ts`), then the PDF/UA pass runs (artifacts, list bodies, link descriptions, role map, XMP metadata; `pdfAccessibility.ts`); see ACCESSIBILITY.md.

## PDF pages

A PDF content block becomes one placeholder `<div role="img">` per selected page (`packages/core/src/pdf/pages.ts`), on a named CSS page (`mde-pdf`) with no margins or margin boxes. In the preview, pdf.js draws each page into its placeholder (`packages/ui/src/preview/pdfPages.ts`). For export, the print window reports which printed pages hold placeholders; the backend copies the real pages over them with pdf-lib, flattening form fields, and reuses the `Figure` element Chromium wrote for the placeholder so the page keeps its place in the reading order. Arranged parts are copied the same way before and after the document.

## Preview editing and scroll sync

Block elements carry `data-src-line` (their first source line). A double-click makes a paragraph, heading, list item or table cell editable as plain text (`packages/ui/src/preview/editing.ts`); a cell is identified by its row's `data-src-line` and its column, and core finds its text in the row by splitting it at unescaped pipes as markdown-it does. On Enter the old and new text go to the parent, and core (`previewEdit.ts`) parses that block's markdown again, projects it to the text the preview shows with the source range of every character, checks that the projection equals the old text, and turns the difference into a source change. Changes that would cut through formatting are refused. Line breaks travel as U+2028 in both directions: the preview reads each `<br>` as one, core projects `<br>` and hard breaks to it, and a U+2028 typed with Shift+Return in a heading is written as `<br>`. Edits to the open document go through the editor (undo and authorship work as for typing); edits to included files are written by the backend with their authorship spans shifted.

Scroll sync uses the same attributes in both directions (`packages/ui/src/preview/sourceLines.ts`), with fractional lines so a position inside a long paragraph is kept. Content from an included file maps to its include line.

## Components, search, tags and the web page

- **Components.** Compose finds `{% include %}` lines and inline tags (outside code), renders the template from the theme's `includes/` folder or the app's built-in `seed/Components`, and records which were used so the backend adds their CSS. The backend reads the root document's `theme` before composing, so components come from the right theme.
- **Search.** `SearchService` walks Collections/, matching names and the text of text files (cached by modification time); matching ignores case, accents and quote styles (`packages/core/src/search.ts`).
- **Finder tags.** The host reads and writes extended attributes (`readXattr`/`writeXattr`: `/usr/bin/xattr` on macOS, a JSON file elsewhere); core encodes the binary property list, checked against Python's plistlib output in tests.
- **Web page.** A hidden window loads `print.html` and draws diagrams and inserted PDF pages without laying out pages; the backend wraps the HTML with the CSS and replaces local URLs with `data:` URIs.

## AI reference files

`ReferenceService` (`packages/backend/src/references.ts`) lists a project's `References/` folder and other ticked files, extracts text (pdf.js for PDF, the document XML for `.docx`), estimates tokens, and loads the ticked files for each request. The Claude driver sends PDFs as document blocks and images as image blocks, with a cache breakpoint after them; the OpenAI-compatible driver sends text in `<reference>` tags plus image parts. The UI only passes the project path; file contents never go through the renderer.

## AI

- Providers implement `ProviderDriver` (`packages/backend/src/ai/types.ts`): Claude through the official Anthropic SDK (`ai/anthropic.ts`), everything else through the OpenAI-compatible chat completions API (`ai/openaiCompatible.ts`).
- Prompts are built in core (`packages/core/src/ai.ts`) so every host sends the same instructions.
- Requests stream from the backend to the UI as `ai-delta`, `ai-done` and `ai-error` events; the UI can cancel them.
- Claude defaults: `claude-opus-5-5`, effort `medium`, streaming with `max_tokens` 64000, structured JSON output for reviews and headline suggestions, and server-side refusal fallback (`fallbacks: "default"`) when talking to the Claude API directly.
- API keys are stored by the host (Electron `safeStorage`, backed by the macOS Keychain) in `userData/secrets.json`; the renderer never sees them.

## Thesaurus

`scripts/build-thesaurus.mjs` turns the WordNet 3.1 database (`wordnet-db`) into a 4.6 MB compressed file at build time: synsets with short glosses, synonyms, similar words, broader and narrower terms, ordered by WordNet's sense frequency counts. The backend loads it a few seconds after start-up (`ThesaurusService`) and answers `thesaurus.lookup`. Core (`thesaurus.ts`) finds the dictionary form of an inflected word and inflects the synonyms to match (walked → strolled, cars → automobiles) with compromise, and orders senses by the part of speech the word has in its sentence. The editor shows the results in the context menu of a selection.

## Checks

Spelling uses the platform spellchecker (custom decorations). Grammar (Harper, WebAssembly in a Web Worker), style rules, AI review and readability feed one CodeMirror lint source (`packages/ui/src/editor/checks.ts`). Rules and grammar run on a masked copy of the text where code, HTML, front matter, URLs and content blocks are blanked to spaces (`packages/core/src/prose.ts`), so positions stay aligned.

## Third-party components

| Component | Use | License |
| --- | --- | --- |
| Electron 44 | App shell, PDF printing | MIT |
| Paged.js 0.4.3 | CSS Paged Media layout (pages, margin boxes, counters, string-set) | MIT |
| CodeMirror 6 | Editor | MIT |
| markdown-it, markdown-it-footnote | Markdown | MIT |
| highlight.js | Code highlighting | BSD-3-Clause |
| yaml | Front matter | ISC |
| fflate | History compression, ZIP export | MIT |
| @noble/hashes | SHA-256 | MIT |
| diff (jsdiff) | Version diffs | BSD-3-Clause |
| React, zustand | UI | MIT |
| @anthropic-ai/sdk | Claude API client | MIT |
| harper.js | Offline grammar checking | Apache-2.0 |
| @codemirror/lint | Underlines and fix suggestions | MIT |
| IBM Plex Sans, IBM Plex Mono (@fontsource) | Interface and editor fonts | SIL Open Font License 1.1 |
| WordNet 3.1 (wordnet-db) | Thesaurus data, built into `dist/thesaurus` with its licence | WordNet licence (Princeton); package MIT |
| compromise | Word forms for the thesaurus | MIT |
| pdf-lib | PDF accessibility post-processing, PDF inserts | MIT |
| pdf.js (pdfjs-dist) | PDF page images in the preview and page picker; PDF text for AI references | Apache-2.0 |
| Mermaid | Diagrams | MIT |

Paged.js has had no stable release since 0.4.3 (July 2023). It sits behind `packages/ui/src/preview/render.ts`, so it can be replaced. Vivliostyle was considered; it is AGPL-3.0.
