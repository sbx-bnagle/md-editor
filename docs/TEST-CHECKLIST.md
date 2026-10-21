# Manual test checklist

For a release build on an Apple Silicon Mac (macOS 13 or later). Each item is an action, then the expected result after →. Items that say **record** have no settled expected result: note what happens. **[Mac]** marks items the automated tests cannot cover, because they run on Linux (see the last section).

When something fails, note the document, the steps, and take a screenshot. Keep a copy of the library before the destructive items.

## 0. Install and first launch

- [ ] Unzip, run `xattr -cr "MD Editor.app"`, open → the app starts with no “damaged” or “unidentified developer” alert. **[Mac]**
- [ ] About MD Editor → version 0.5.1. **[Mac]**
- [ ] First launch with no library → offers `~/Documents/MD Editor Library`; the library has Examples › Feature Tour, the Classic and Modern themes, a Report template and sample guides.
- [ ] Open Another Library… → switches library; the previous one is not changed.

## 1. Tables in the editor (new)

Make a test document with a paragraph, a table of six columns with long cells, a short table that fits the column, a table with formatting in its cells, and a sentence containing `a | b`.

Layout

- [ ] A long table shows one line per row; text past the column's right edge is cut off at the edge, not drawn into the margin.
- [ ] A table that fits the column shows no scroll bar.
- [ ] Paragraphs, lists, quotes and headings still wrap.
- [ ] `a | b` in a sentence, and pipe rows with no `| --- |` separator row, wrap like prose.
- [ ] Table rows have the same line height as other single lines; the last row has room for its scroll bar.
- [ ] Repeat at editor zoom 50% and 200% (⌘− / ⌘+), with another editor font and size (Settings), and with the window narrow and wide → the cut-off follows the column edge.
- [ ] Light and dark appearance → the scroll bar is visible in both.

Scrolling

- [ ] Two-finger swipe sideways over any row → every row of that table moves together. **[Mac trackpad]**
- [ ] Shift + mouse wheel over a row → the same. **[Mac mouse]**
- [ ] Drag the scroll bar under the last row → the same.
- [ ] System Settings › Appearance › Show scroll bars: “Always”, then “When scrolling” → the table's scroll bar follows the setting. **[Mac]**
- [ ] Swipe past either end of a table → the editor does not bounce, go back, or change document.
- [ ] Vertical swipe over a table → the document scrolls up and down.
- [ ] Two tables in one document → each scrolls on its own.
- [ ] The `| --- |` row and other short rows → move off to the left with the rest, rather than staying put.
- [ ] Scroll a table sideways, scroll the document until the table is far off screen, come back → the table kept its offset.
- [ ] Open another document and come back → **record** whether the offset is kept.

Cursor and selection

- [ ] Click in a row and hold → past the right edge → the table scrolls to keep the cursor in view.
- [ ] ⌘→ and ⌘← on a long row → the table jumps to show the cursor.
- [ ] ↑ and ↓ between rows of a scrolled table, and out of the table → the cursor is visible and drawn where the text is.
- [ ] Type at the end of a long row → the text appears and the table follows.
- [ ] Scroll a table so the cursor's spot is out of view → no cursor is drawn in the margins.
- [ ] Select across several rows of a scrolled table → the highlight lines up with the text and stops at the column edges.
- [ ] Drag a selection toward the right edge → **record** whether the table scrolls while dragging.
- [ ] Double-click a word in a scrolled row → that word is selected.
- [ ] Right-click a misspelled word in a scrolled row → suggestions and Thesaurus are for that word. **[Mac spelling]**

Editing

- [ ] Add a column to every row, then remove one → still one line per row, rows aligned.
- [ ] Paste a wide table copied from another app → shown as a table, not wrapped.
- [ ] ⌘Z and ⇧⌘Z after edits in a scrolled table → text correct, rows aligned.
- [ ] Delete the `| --- |` row → the lines wrap as prose; undo → a table again.
- [ ] A table inside a quote or a list item → **record** how it shows.
- [ ] Inline code, links, bold, typed curly quotes, emoji, accented and CJK text in cells → shown correctly; the cursor lands where clicked.
- [ ] Spelling and grammar underlines in a scrolled row → under the right words.
- [ ] AI-written text in a row with authorship shown (⇧⌘A) → dimmed text lines up after scrolling.
- [ ] A 200-row table → typing and scrolling stay responsive.
- [ ] ⌘R to the preview and back → the editor still shows one line per row; the preview, PDF and web page tables look as in 0.5.0.

Accessibility

- [ ] VoiceOver, line by line through a table → each row is read in full, including the part out of view. **[Mac]**
- [ ] Keyboard only → every part of a wide row can be reached with the arrow keys.

## 2. Images in themes (new)

Adding

- [ ] Theme menu (bottom bar) › right-click a library theme › Add Images… › a PNG → notice “Added images/… to “Theme””; the file is in `Themes/<theme>/images/`.
- [ ] Several at once (PNG, JPEG, GIF, SVG, WebP, AVIF) → all copied.
- [ ] The same file again → copied as `name 2.png`; the first is unchanged.
- [ ] A non-image file among them (if the dialog lets you pick one) → an error, and nothing is copied.
- [ ] Cancel the dialog → nothing happens.
- [ ] File names with spaces, accents and emoji → copied, and usable in CSS.
- [ ] Copy CSS in the notice → the clipboard holds `url("images/…")`, one line per image.
- [ ] Right-click a project copy of a theme → Add Images… is not offered (as with Add Fonts…).

Using

- [ ] `@page { @top-right { content: url("images/logo.png"); } }` in theme.css → the logo shows in the preview and the PDF; not in the web page (page margins do not apply on screen).
- [ ] An image as an element's background → shows in the preview, the PDF and the web page.
- [ ] A component `includes/logo.html` containing `<img src="{{ "images/logo.png" | theme_url }}" alt="Logo">`, used as `{% include logo.html %}` → shows in the preview, PDF and web page.
- [ ] A transparent PNG, an SVG with text, and a 20 MB photo → **record** how they look and how long export takes.
- [ ] The web page file moved to another folder and opened offline → theme images still show (embedded).

Export

- [ ] Right-click › Export… → the notice includes “Images included: N” and the font notes; Show in Finder opens the file's folder.
- [ ] theme.css with `url("../../Collections/<collection>/<project>/logo.svg")` (an image elsewhere in the library) → the notice says “Copied in from the library: …”; the library theme's CSS is unchanged.
- [ ] Rename a copy of the `.mdtheme` to `.zip` and open it → `images/` holds the copied image; the packaged theme.css points at `images/logo.svg`.
- [ ] An image outside the library (`url("../../../../Desktop/x.png")`) → listed as not included.
- [ ] An image that does not exist → listed as missing.
- [ ] Two different library images with the same file name → packaged as `name.ext` and `name 2.ext`; each rule points at the right one.

Import

- [ ] Import theme… on the same Mac → “Name 2”, “It includes N images”; the images show in the preview.
- [ ] Import on a second Mac or user account without the original library → the images show in the preview, PDF and web page. **[Mac]**
- [ ] A package referring to images it lacks → the notice lists them.
- [ ] A theme folder compressed in Finder (Compress) → imports. **[Mac]**
- [ ] A package over 100 MB → refused with a message.

Other

- [ ] Customize “Theme” for this project → the project copy has the images and shows them.
- [ ] Duplicate… a theme with images → the copy has them.
- [ ] Library history: checkpoint the themes, delete a theme image, restore → **record** whether the image comes back.

## 3. Across the app

Library and sidebar

- [ ] + menu: New Collection…, New Project…, New Project from Template…, New Template from Project… → created and listed.
- [ ] Rename…, Move to Trash, Show in Finder on a file, folder and project.
- [ ] Add, rename and delete files in Finder → the sidebar updates. **[Mac]**
- [ ] Library search (⇧⌘F): file and folder names; text inside files; “cafe” finds “Café”; straight and curly quotes match each other; lines with more of the words come first; clearing the field restores the tree.
- [ ] Right-click › Tags › a colour → a dot after the name; Finder shows the same tag. **[Mac]**
- [ ] Add or remove a tag in Finder → the dot follows (after the sidebar refreshes). **[Mac]**
- [ ] Several colours, and a custom named tag set in Finder → **record** how they show. **[Mac]**
- [ ] Tags on a Mac without the Xcode Command Line Tools → **record** (the app calls `/usr/bin/xattr`). **[Mac]**

Editor

- [ ] Typing quotes and `--` / `---` → curly quotes, en and em dashes; straight inside code, HTML tags, front matter and content block lines; Edit › Convert Quotes and Dashes converts existing text.
- [ ] Edit, wait → the circle at the bottom right fills (saved); while unsaved it is an outline; quit right after typing → nothing lost.
- [ ] Zoom: ⌘+, ⌘−, ⌘0 and the − / + in the top bar → **record** whether the zoom is kept after relaunch.
- [ ] Right-click: Ask AI… (with a selection), Insert HTML Entity, Emoji & Symbols… **[Mac]**, Insert Inline Image, Thesaurus, spelling suggestions, Learn Spelling and Ignore Spelling **[Mac]**.
- [ ] Inline image → sized to the text in the preview and the PDF.
- [ ] The # and page icons, and ⌘R → switch between Markdown and Preview.
- [ ] Change the open file in another editor → the app shows the new text. **[Mac]**
- [ ] A 50,000-word document → typing stays responsive.

Content blocks, variables and components

- [ ] Content block lines for a markdown file, CSV, image, code file, `.mmd` diagram and a missing file → included, table, figure, highlighted code, diagram, and a “missing” box.
- [ ] `/forms/x.pdf#pages=3,1-2 "Title"` and Choose PDF Pages… → those pages in the preview and the PDF.
- [ ] Front matter variables in `{{name}}` and in the theme's margin boxes; an included document overriding one → headers follow the section on each page.
- [ ] `{% include figure.html … size="half" align="right" %}` → half-width figure, text beside it; `page-includes: footer.html` → a footer on every page.
- [ ] A component image without alt text → listed in the problems before export.

Preview

- [ ] The page field shows “X / Y”; type a page number and press Return → jumps to that page.
- [ ] Scrolling the editor and switching to the preview (and back) → the same place.
- [ ] Double-click a paragraph in the preview, edit, press Return → the markdown changes.
- [ ] Mermaid diagrams use the theme's font.

Themes and fonts

- [ ] New theme…, Duplicate…, Rename…, Move to Trash, Edit CSS with ⌘R to preview.
- [ ] Add Fonts… with TTF, OTF, WOFF and WOFF2 → `@font-face` rules added after any `@import`; the font is used in the preview and embedded in the PDF (check with Preview › Tools › Show Inspector, or `pdffonts`).

Export

- [ ] Export PDF… (⇧⌘E) → accessibility warnings for missing image descriptions and skipped heading levels; the PDF opens and is tagged (check with Acrobat's accessibility checker or PAC, if available).
- [ ] The export dialog's arrangement: PDFs before and after the document, reordered → the PDF follows the order.
- [ ] Export Web Page… (⌥⌘E) → one .html file that opens offline.
- [ ] Export ZIP…, with and without Include version history → the ZIP opens; history included only when ticked.

History

- [ ] Edit and pause → an automatic version appears; Create Checkpoint… (⌥⌘S) → a named version; Show History (⌥⌘H) → compare and restore.
- [ ] With the library in iCloud Drive or Dropbox, edit one project on two Macs → the sync service's conflict copy of the history file is merged. **[Mac, two machines]**
- [ ] History for all themes and for all guides → checkpoint and restore.

AI (needs an API key or a local model)

- [ ] Settings (⌘,) › AI: paste a key, choose a model → saved; reopening Settings does not show the key. **[Mac Keychain]**
- [ ] ⌘K at the cursor and on a selection; Chat (⌥⌘K) with Insert into Document; Review with AI (⌥⌘R) → results; AI text shown dimmed (⇧⌘A to toggle).
- [ ] Add AI Reference Files… (a PDF RFP), tick it → the Assistant answers from it; the review lists requirements not addressed.
- [ ] Ollama or LM Studio as an OpenAI-compatible service → works without a key.
- [ ] A wrong key, and no network → a clear error, no hang.

Guides, Insights and Settings

- [ ] Guides menu in the bottom bar: choose voice and style guides for a project → style underlines change; a voice refinement proposal can be accepted.
- [ ] Insights (⇧⌘I): readability scores, headline scores with AI alternatives; readability highlighting follows the target grade in Settings.
- [ ] Settings: your name (recorded as the author of text you type, when authorship recording is on), editor font and size.

Accessibility and appearance

- [ ] VoiceOver through the sidebar, editor, preview, side panel and dialogs → controls are named. **[Mac]**
- [ ] Keyboard only → every control reachable; focus visible.
- [ ] Increase Contrast, Reduce Motion, light and dark appearance. **[Mac]**

Robustness

- [ ] Force-quit while typing, relaunch → at most the last few seconds lost.
- [ ] Library on iCloud Drive with “Optimize Mac Storage” and files not downloaded → **record** behaviour. **[Mac]**
- [ ] A read-only file → **record** behaviour.
- [ ] File and folder names with emoji, accents and long paths.

## 4. Covered by automated tests

These run on Linux under Xvfb (`npm test`, then the three end-to-end suites), so they do not exercise macOS services: Finder tags use a JSON stand-in, and the AI uses a local mock. Step names as printed by the suites:

- `apps/desktop/e2e/smoke.mjs`: library seeded; curly quotes while typing, straight inside HTML tags and code; autosave; preview renders pages with running headers; layout; tables in the editor do not wrap, they scroll sideways as a whole; scroll sync between the editor and the preview; library search: names and text; text editing in the preview; new collection from the + menu; Finder tag dots from the context menu; theme menu in the bottom bar; guides menu in the bottom bar; PDF export through the host API; history panel with checkpoint; new project from template; template from a project, then a project from that template; theme CSS editing; theme export and import, with images; library-level history for themes; theme-local font and margin-box image load through the asset protocol.
- `apps/desktop/e2e/writing.mjs`: configure an OpenAI-compatible service (mock); settings dialog; guides from project settings; typed dashes and grammar/style underlines; command bar writes at the cursor and records authorship; authorship view toggle; chat panel inserts a draft; reference files sent with requests; insights; readability highlighting; rewrite a selection; thesaurus in the context menu; voice refinement proposal.
- `apps/desktop/e2e/pdf.mjs`: export the fixture and the Feature Tour; diagrams in the theme font; accessibility warnings before export; theme components; PDF pages inserted, chosen and arranged; single-page web export; PDF tags; veraPDF PDF/UA-1 (when `VERAPDF` is set).
