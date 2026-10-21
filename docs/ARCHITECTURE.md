# Architecture

The app is split into layers so the UI and document logic can move to another shell (Tauri, a native app hosting a JS engine, a web app) by replacing only the host layer.

```
packages/core      Platform-independent logic. TypeScript only: no Node, DOM, or Electron APIs.
                   Markdown pipeline, content blocks, variables, curly quotes and dashes,
                   authorship annotations, history file format, diffs, theme CSS processing,
                   style rules, readability, headline heuristics, AI prompts, preferences,
                   thesaurus lookups, diagram placeholders, PDF artifact marking,
                   and the AppApi contract (src/api.ts).
packages/backend   Node.js services implementing AppApi (library, documents, themes, render,
                   history, export and the PDF accessibility pass, guides, AI providers,
                   thesaurus, file watcher). No Electron or DOM
                   APIs. Needs a HostAdapter (src/host.ts) for Trash, Finder, dialogs, PDF
                   printing, events and encrypted secrets.
packages/ui        React UI. Uses core for pure functions and talks to the host only through
                   AppApi, built on a small transport (src/api/host.ts). No Node or Electron APIs.
apps/desktop       Electron host: main process, preload bridge, menus, protocols, PDF printing.
resources/seed     Themes, templates and an example project copied into a new library.
scripts            Layer boundary check; thesaurus data builder (WordNet → dist/thesaurus/en.thes).
```

## Rules

- `npm run check:boundaries` fails when a layer imports something it should not (`scripts/check-boundaries.mjs`).
- Each package's `tsconfig.json` limits ambient types: core has neither DOM nor Node types; ui has DOM only; backend has Node only.
- Every AppApi method is async and takes and returns plain serializable data, so any transport (IPC, HTTP, a native bridge) can carry it.
- The backend validates that every path from the UI is inside the open library.

## Porting

| To | Keep | Replace |
| --- | --- | --- |
| Tauri | core, ui, backend (as a Node sidecar) | apps/desktop → Tauri shell implementing the transport and HostAdapter |
| Native macOS (Swift) | ui in a WKWebView; core in JavaScriptCore | backend → Swift services implementing AppApi |
| Web | core, ui | backend behind HTTP; HostAdapter for downloads instead of save dialogs |

## Data flow

1. The UI calls `api.render.document({ docPath, overrides })`. Unsaved editor text is passed as an override.
2. The backend reads files, and core composes the document: front matter → variables → content blocks (recursively, each file with its own scope) → markdown-it → HTML with hidden scope markers.
3. Core builds the stylesheet: base CSS + theme CSS (relative URLs resolved, margin-box `var()` rewritten to `string()`) + variable rules.
4. The UI loads a fresh iframe (`preview.html`), draws Mermaid diagrams with the theme's font (`packages/ui/src/preview/diagrams.ts`) and lays the HTML out with Paged.js. PDF export runs the same layout in a hidden window (`print.html`) and calls Chromium's `printToPDF`, so preview and PDF use the same engine.
5. The backend post-processes the tagged PDF for PDF/UA (artifacts, list bodies, link descriptions, role map, XMP metadata); see ACCESSIBILITY.md.

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
| pdf-lib | PDF accessibility post-processing | MIT |
| Mermaid | Diagrams | MIT |

Paged.js has had no stable release since 0.4.3 (July 2023). It sits behind `packages/ui/src/preview/render.ts`, so it can be replaced. Vivliostyle was considered; it is AGPL-3.0.
