# Roadmap

## Decisions so far

| Topic | Decision |
| --- | --- |
| Technology | Electron, with strict layer separation for later ports (see ARCHITECTURE.md) |
| Code location | github.com/sbx-bnagle/md-editor |
| App name, bundle id | Placeholders for now (“MD Editor”, `local.mdeditor.app`) |
| Signing | Ad-hoc only; a Developer ID is not needed until the app is distributed to others |
| Library storage | Plain Finder folders: `Collections/`, `Templates/`, `Themes/`, `Guides/`; the sidebar lists collections only |
| Versioning | Automatic snapshots plus named checkpoints; one sync-friendly history file per project |
| Variables | YAML front matter per document; included documents inherit and can override locally; no variables inside front matter values |
| Content blocks | iA Writer syntax; paths must stay inside the project folder |
| Theme variables | Main document's values, replaced per section in headers and footers |
| Export | Any markdown document in a project, chosen at export; ZIP with optional history |
| Themes | Library themes; a project can customise its own copy |
| Theme, voice, style selection | Per project, overridable per document in front matter |
| Page size | US Letter in bundled themes |
| Quotes and dashes | Curly quotes as you type; `--` en dash, `---` em dash; a line of hyphens stays syntax; `___` also makes a rule |
| Authorship | iA Writer Markdown Annotations format; AI text dimmed with a show/hide toggle |
| Interface | IBM Plex Sans; dark palette with a slight cool cast; WCAG 2 AAA contrast for all text; sentence case; icons only for projects (filled folder) and folders (outlined) |
| Layout | Top bar: Markdown/Preview toggle on the left, AI, PDF and panels on the right. Bottom bar: counts, guides menu, theme menu, AI text toggle, save state. Sidebar: collections and projects without a section label; + menu creates collections, projects and templates. No breadcrumbs, no library footer |
| Templates, themes, guides | Not in the sidebar. Templates through the + menu (from a project, or a new project from one); themes and guides edited and created from their bottom-bar menus |
| Editor font | IBM Plex Mono, 20 px by default; column about 75% of the editor, capped near 80 characters (48em). Any installed font can be chosen in Settings. iA Writer's fonts are not bundled: iA's guidelines ask editors not to bundle them or use them as defaults |
| Thesaurus | Offline, WordNet 3.1; synonyms inflected to match the selection; in the context menu of selected text |
| Diagrams | Mermaid 11, theme font, never split across pages |
| Accessible PDF | Chromium tags plus a PDF/UA post-processing pass; veraPDF PDF/UA-1 validation in the test suite; PDF/UA identifier only when the pre-export check passes |
| AI | Claude (default `claude-opus-5-5`) plus any OpenAI-compatible endpoint |
| AI interface | Inline command bar (⌘K) and a chat panel |
| Checking | Live and local (macOS spelling, Harper grammar, style rules) plus on-demand AI review |
| Style guides | Base + overrides on unofficial AP-like, Chicago-like and Oxford-like bases |
| Voice guides | Markdown prose, refined manually and through AI-proposed changes from edits |
| Preview editing | Text edits only, written back to the markdown; changes that would cut through formatting, variables or footnotes are refused with a pointer to the editor |
| Scroll sync | Both directions, by source line, when switching between Markdown and Preview |
| AI reference files | Per project, chosen file by file; Claude gets PDFs and images natively, other services extracted text; used by the Assistant, ⌘K and Review with AI |
| PDF pages in exports | Content block lines with an optional `#pages=` selection, plus a saved per-document arrangement of PDFs before and after the document |
| Library search | Bottom of the sidebar; names and text, ignoring case and accents |
| Status dots | macOS Finder tags on the files (extended attribute), so Finder shows them too |
| Theme components | Jekyll include syntax and a Liquid subset; built-in figure and footer; themes add their own in `includes/`; output escaped by default |
| Web export | One self-contained .html file |
| Theme sharing | `.mdtheme` zip with fonts and images; installed fonts are listed, not copied; images the theme's CSS takes from elsewhere in the library are copied in, with the packaged CSS pointing at the copies |
| Tables in the editor | No wrapping; each row clipped at the text column; one horizontal offset per table, following the cursor; hyphens on lines with a `|` are not turned into dashes |
| Tabs | Browser-style: a click opens in the current tab, ⌘-click or Open in New Tab in a new one; ⌘T empty tab; new files open in a new tab; a file open in a tab is shown there rather than opened twice; tabs restored at launch |
| Library visibility | ⌘E (View › Toggle Library), kept between sessions |
| Side panel (0.6.1) | Full window height in the darker sidebar grey; while open, Assistant, Insights and History are tabs in the panel's own top bar (see-through, content scrolls behind it); while closed, they are buttons in the top bar. Choosing the open tab closes the panel |
| Top bar (0.6.1) | No PDF button (File › Export PDF…, ⇧⌘E, and the library's context menu remain); + in the tab bar is New File… (⌘N) |
| Preview background (0.6.1) | The editor's grey (--bg-elev), not a separate darker grey |
| Formatting keys (0.6.2) | ⌘B `**`, ⌘I `*`, ⌘M `==` (Format menu); toggles around each selection or the word at the cursor; Minimize moved to ⌥⌘M |
| Marked text (0.6.2) | `==text==` → `<mark>`, an extension (iA Writer, Obsidian, Typora use it) |
| Page breaks (0.7.1) | `+++` on its own line → `<div class="page-break">`; `break-after: page` in the base styles, so every theme breaks there |
| Assistant edits (0.7.0) | The Assistant proposes changes as ````edit```` (SEARCH/REPLACE) and ````create```` blocks; each shows before/after with Apply, a reply with several has Apply All; applying opens the file in a tab if needed and edits it in the editor (AI authorship, undo). Any file in the project, never outside it or in `.mdeditor/`. The project's other markdown files go with each message when “Project files” is ticked (references excluded; about 200,000 characters at most, the rest named only) |
| Assistant chats (0.6.3) | One conversation per project, saved in `.mdeditor/chat.json` after each message and reply; themes and guides share one per library folder; Clear Chat… deletes it; the most recent ~60,000 characters are sent with each message |
| Tables without a header row (0.6.2) | A block starting with a separator row is a table with a body only; it does not interrupt a paragraph |
| Editor size | 22 px type, column about 82% of the editor (both 10% up from 20 px and 75%) |
| Interface (iteration 4) | No “Library” label; # / page icons for Markdown and Preview; side panel below the top bar, switched from the top bar; page field “3 / 12”; editor zoom; save state as a circle; no grammar/style counts in the bottom bar; Ask AI in the context menu |
| History retention | Named versions kept; automatic versions thinned by age (day, then daily for 30 days, then weekly); sync conflict copies merged |
| Mac target | Apple Silicon |

## Iteration 1 (done)

Library, editor, themed paged preview, variables, content blocks, curly quotes, spelling underlines, PDF and ZIP export, version history, theme CSS editing, authorship annotations preserved.

## Iteration 2 (done)

- Interface refresh: IBM Plex Sans and Mono, neutral palette, sentence case, aligned bottom bars, project/folder icons only.
- Smart dashes as you type and at render time; content blocks limited to the project.
- Settings: author name, editor font and size, authorship recording and display, checks, AI services with keys in the Keychain.
- AI services: Claude (Anthropic SDK, streaming, refusal fallback) and OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio).
- ⌘K command bar (write at cursor, rewrite selection), Assistant chat with insertable drafts, AI authorship recorded and dimmed.
- Voice and style guides with project and document selection; style rule engine; Refine from edits for voice guides.
- Grammar (Harper, offline), style, AI review and readability underlines with fixes.
- Insights panel: readability grades for the file or the whole composed document, headline clarity/engagement scores with AI alternatives, AI review.

## Iteration 3 (done)

- Interface revisions from iteration 2 feedback: layout (top and bottom bars, sidebar), larger editor type in a wider column, cooler palette with WCAG AAA contrast.
- Inline thesaurus in the context menu.
- **Accessible PDF**: tags checked against PDF/UA-1 with veraPDF (see ACCESSIBILITY.md); artifacts for headers, footers and decoration; list bodies; link descriptions; XMP metadata; document language; pre-export warnings for missing descriptions and heading levels.
- **Diagrams with Mermaid**: fences and `.mmd` content blocks, drawn in the theme's font at page width, kept on one page, tagged as figures with their description.
- **AI reference files** per project (RFPs, addenda, briefs), sent with Assistant, ⌘K and review requests; the review lists requirements the document does not address.
- **PDF pages in exports**: PDF content blocks with a page picker, and an export arrangement of PDFs before and after the document; tagged as figures, PDF/UA kept when the inserted files allow it.
- **Text editing in the preview** (double-click a paragraph, heading or list item), written back to the document or the included file.
- **Scroll sync** between editor and preview in both directions.
- **History**: pruning of automatic versions, merging of sync conflict copies, history for the library's themes and guides.

## Iteration 4 (done)

- Library search and filter at the bottom of the sidebar.
- Finder tag colours as dots in the library, set from the context menu.
- Theme components (Jekyll includes): sized figures, a footer on every page, theme-provided components.
- Single-page web export.
- Editor zoom.
- Theme export and import with fonts; Add Fonts writes @font-face rules.
- Context menu: Ask AI on a selection, HTML entities, emoji picker, inline images.
- Interface: view toggle icons, side panel below the top bar, page field with jump, save circle, simpler bottom bar, no “Library” label.

## Iteration 4.1 (done)

- Tables in the editor do not wrap; they scroll sideways as a whole.
- Images in theme packages: Add Images…, images from elsewhere in the library copied in on export, image counts and gaps reported on export and import.
- Manual test checklist (docs/TEST-CHECKLIST.md).

## Iteration 5 (done)

- Tabs for open documents.
- ⌘E hides and shows the library.
- Find and Replace, Replace All, Select All Occurrences and Select Next Occurrence in the Edit menu.
- Hyphens stay hyphens in table rows.
- No rules on the top and bottom bars or above the library search; the search field and the bottom bar share a height, so their text lines up.
- Editor type and column 10% larger.

## Iteration 5.1 (done)

- + in the tab bar runs New File… (⌘N).
- No PDF button in the top bar.
- Side panel at full height, with its tabs in its own top bar.
- Preview background in the editor's grey.

## Iteration 5.2 (done)

- Tables may start with a separator row.
- ⌘B, ⌘I and ⌘M (Format menu) for bold, italic and marked text; `==marked text==` support.

## Iteration 5.3 (done)

- Assistant chats per project, kept between sessions.

## Iteration 6 (done)

- The Assistant proposes changes to any file in the project, and new files; the writer applies them.

## Iteration 6.1 (done)

- `+++` page breaks.

## Things that may read as iA Writer–like

Kept for compatibility, as decided, and listed so they can be reviewed:

| Item | Status |
| --- | --- |
| Content block syntax | iA published it as an open spec and invites other apps to support it |
| Markdown Annotations (authorship) | iA calls the format open but asks others not to clone their design; we read and write the format only |
| Dimmed AI text | Same visual idea as iA's authorship view; kept by request, with a toggle |
| Monospaced, centered editor column | A common editor layout; editor font is IBM Plex Mono, not iA's fonts |
| ⌘R toggles preview | A common preview shortcut that may match iA Writer's; could change |
| Live style underlines | Possibly similar to iA Writer's style checking; ours checks the rules of a chosen style guide |

## Known limitations

- Paged.js (0.4.3, last stable release July 2023) handles the layout; complex CSS (floats across pages, footnotes as page-bottom notes) has gaps. It is isolated behind one module.
- Style rules are heuristics; some (serial commas, numbers, sentence case) can miss cases or flag correct text.
- Readability scores use estimated syllable counts.
- Headline scores are rules of thumb, not predictions.
- Grammar checking is US English only (Harper).
- The thesaurus is English (WordNet 3.1). Inflected forms come from compromise and can be wrong for rare words; synonyms are listed by WordNet sense, not by how well they fit the sentence.
- A paragraph or list broken across pages is tagged as two elements in the PDF.
- Preview editing changes text only. Tables, captions, footnote text and list items that contain other lists are edited in the editor.
- Inserted PDF pages keep their own size; page numbers in the document's headers count pages inserted with content blocks but not the parts placed before or after the document.
- Finder tags are written with `/usr/bin/xattr`; this was tested only with the Linux stand-in (a JSON file), not on a Mac. If `xattr` is unavailable, tags do not show and setting one reports an error.
- The emoji picker is the macOS one (Electron `app.showEmojiPanel`); it is not available on other systems.
- Component templates support a subset of Liquid (no loops or assignments). Running elements need a more specific selector than Paged.js's own margin rule (see THEMES.md).
- The web page uses the theme's print sizes (points); themes can add `@media screen` rules.
- Editor tables: rows scroll as one, but columns are not lined up (the markdown is shown as written). A table row longer than the column always shows one line, so text past the edge is seen by scrolling or moving the cursor.
- `+++` lines are page breaks everywhere outside code, including at the top of a file: TOML front matter (`+++` … `+++`, used by Hugo) is not read as front matter.
- `==marked text==`, `+++` page breaks and tables that start with a separator row are the app's extensions; GitHub and other markdown tools show them as text.
- Formatting keys use `*` for italic and `**` for bold; text formatted with underscores (`_x_`, `__x__`) is not recognised when toggling, so the markers are added rather than removed.
- Assistant changes are found by their exact text (curly and straight quotes count as the same). If the file changed since the reply, or the text occurs more than once, the change is marked and not applied; ask again. Applying a change to a file in a background tab reloads that tab, so its earlier undo history is lost.
- “Project files” sends every markdown file in the project (up to about 200,000 characters) with each message; with Claude these are cached between messages, other services receive them every time.
- One Assistant conversation per project; there is no list of past conversations. Clear Chat… deletes the conversation. If two Macs add to the same chat before syncing, the sync service keeps one version (or makes a conflict copy, which the app does not merge).
- Long chats: only the most recent turns, up to about 60,000 characters, are sent with each message; earlier ones stay in the panel but the AI no longer sees them.
- Tabs cannot be reordered by dragging. A file is open in at most one tab. ⌘W on a window whose only tab is empty does nothing (Close Window is ⇧⌘W).
- ⌘F, ⌘D and ⇧⌘L are both Edit menu shortcuts and editor keys; a press that reaches both runs once (a press from the other source within 150 ms is ignored). This was tested with Playwright key events on Linux, not with the macOS menu.
- Theme export copies only images inside the library that the theme's CSS refers to with relative `url()` paths. Images in component templates must be in the theme folder (`theme_url`); images outside the library are listed as not included.
- Word files used as references are read as plain text (paragraphs, tabs and line breaks); tables come through as runs of text and images are left out.
- The app is unsigned; see README for the one-time steps.
