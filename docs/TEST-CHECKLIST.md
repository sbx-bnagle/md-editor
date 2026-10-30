# Manual test checklist

For a release build on an Apple Silicon Mac (macOS 13 or later). Each item is an action, then the expected result after →. Items that say **record** have no settled expected result: note what happens. **[Mac]** marks items the automated tests cannot cover, because they run on Linux (see section 5).

When something fails, note the document, the steps, and take a screenshot. Keep a copy of the library before the destructive items.

## 0. Install and first launch

- [ ] Unzip, run `xattr -cr "Folio Dome.app"`, open → the app starts with no “damaged” or “unidentified developer” alert. **[Mac]**
- [ ] About Folio Dome → version 0.10.0; the menu bar, Dock, Finder and window show the name Folio Dome and the FD icon. **[Mac]**
- [ ] First launch after using MD Editor → the same library, tabs and preferences as before; AI services listed, but their keys show as not set. Enter each key once → the services work, and keep working after a relaunch. macOS may ask for Keychain access once (“Folio Dome Safe Storage”). **[Mac]**
- [ ] First launch with no library (no MD Editor settings either) → offers `~/Documents/Folio Dome Library`; the library has Examples › Feature Tour, the Classic and Modern themes, a Report template and sample guides.
- [ ] Open Another Library… → switches library; the previous one is not changed.

## 1. Tables in the editor (0.5.1)

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

## 1a. Lists in the editor (0.9.6)

Make a document with a paragraph, a bullet list with an item long enough to wrap, a nested list (typed with two spaces in one item and four in another), a second paragraph inside an item, a numbered list of 1. to 3., then a paragraph and a numbered list of 1. to 10.

- [ ] Each marker (- or 1.) starts at the same left edge as the paragraph text.
- [ ] Item text in every list starts 3 characters in; in the list that reaches 10., all items start 4 characters in.
- [ ] Wrapped rows of an item line up with the item's text, not with the marker.
- [ ] Nested markers line up with their parent's text, and nested text sits one more step in, whether two or four spaces were typed.
- [ ] A second paragraph inside an item lines up with the item's text.
- [ ] Return at the end of an item → a new marker, with the cursor at the text edge; type → the text starts there.
- [ ] Reopen the file in another editor → the markers and spaces are as typed (the indent is display only).
- [ ] Settings › General › a different editor font or size → the indent follows the new character width.
- [ ] A list inside a block quote (`> - item`) → shown as typed.

## 1b. Line breaks in headings (0.9.8)

- [ ] In a `##` heading, put the cursor between two words, Shift+Return → the file has `<br>` there; the editor shows a grey `\` at the end of the first row and the rest of the heading on the next row, under the heading's text; the cursor is at the start of the second row.
- [ ] Arrow left and right over the break → one step each; Backspace at the start of the second row → the whole `<br>` goes; ⌘Z brings it back.
- [ ] Shift+Return in a paragraph, a list item or a code block → a new line, as before.
- [ ] Preview and PDF → the heading on two lines; a running header taken from the heading reads “first part second part” with a space.

## 1c. Drag and drop in the library (0.9.9)

- [ ] Drag a file from one project onto another project's row → it moves there; the target row is outlined while hovering; the file's open tab follows it; both projects' histories record the change.
- [ ] Drag a folder onto a folder in another project → it moves with its contents. Onto itself or a folder inside it → no drop.
- [ ] Hold ⌥ while dropping → a copy; the original stays. ⌥ onto the item's own folder → a duplicate named “name 2”.
- [ ] Drop where the name is taken → ““name” is already in “folder””: Keep Both → the dropped one gets a number; Replace → the one there goes to the Trash (its tab closes); Stop → nothing changes.
- [ ] Drag files and a folder from Finder onto a project or folder row → they move into the project (gone from Finder's location); with ⌥ → copied. A folder that is a Folio Dome project → refused with a message. **[Mac]**
- [ ] Drag a file or folder from the library to the Desktop or a Finder window → a copy appears there; the library still has its file (check the same disk as the library, where Finder would otherwise move it). **[Mac]**
- [ ] Drag a library item over the editor and drop it there → nothing is inserted.
- [ ] Projects and collections cannot be dragged; Themes, Templates and Guides are not drop targets.

## 1d. Lists: typing and selecting (0.9.9)

- [ ] In a list item, click at the start of the item's text and type → the text goes there. In an empty item (`- `), type → the text follows the marker and its space.
- [ ] Drag-select inside an item's wrapped second row, and from one item into the next → exactly the dragged text is selected; Shift+arrows and double-click work as in paragraphs.
- [ ] The markers and text still line up as in 0.9.6 (marker at the text edge, text 3 characters in).

## 2. Images in themes (0.5.1)

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

## 3. Tabs, library, find and replace, layout (new in 0.6.0)

Tabs

- [ ] Click a file in the library → it opens in the current tab; the number of tabs does not change.
- [ ] ⌘-click a file, and right-click › Open in New Tab → it opens in a new tab to the right of the current one.
- [ ] Click a file that is open in another tab → that tab is shown; no second tab for the same file.
- [ ] ⌘T (File › New Tab) → an empty tab, “New Tab”, showing “No document open”; click a file → it opens in that tab.
- [ ] ⌘N (New File…), + at the end of the tab bar, and the sidebar's + menu › New File… → the New File dialog with a Location menu (the open document's folder, else the selected project, then every project); after naming, the new file opens in a new tab. With no projects in the library → “Create a project first.” New Project…, New Theme… and new guides → also open in a new tab.
- [ ] ⌘W (File › Close Tab) → closes the current tab and shows the next one (the previous one at the end of the row). Closing the last document leaves an empty tab; ⌘W on it does nothing.
- [ ] ⇧⌘W (File › Close Window) → closes the window; **record** how to get it back (Dock icon). **[Mac]**
- [ ] × on a background tab → it closes and the current tab stays; middle-click on a tab → it closes.
- [ ] ⌃Tab and ⌃⇧Tab → next and previous tab.
- [ ] Window › Show Next Tab (⇧⌘]) and Show Previous Tab (⇧⌘[), by key and by menu → next and previous tab. **[Mac]**
- [ ] Type in one tab, switch to another and back, ⌘Z → the typing is undone; the cursor and scroll position are where they were.
- [ ] Two open files with the same name (two `theme.css`) → the tabs add the folder: “theme.css — Modern”.
- [ ] 15 or more tabs → **record** how the tab bar behaves (it scrolls sideways, without a scroll bar).
- [ ] Quit with three tabs, one of them empty and the second one active; relaunch → the same tabs, the second one active.
- [ ] Rename an open file, and the folder holding another → their tabs follow the new names. Move an open file to the Trash → its tab closes.
- [ ] Change a file in a background tab with another app, then show the tab → the new text (its undo history is not kept in that case).
- [ ] In Preview (⌘R), switch tabs → the preview shows the other document (Markdown or Preview is shared by all tabs).
- [ ] Open Another Library… → one empty tab.
- [ ] VoiceOver on the tab bar → each tab is read as a tab, with “selected” on the current one; close buttons are read as “Close <name>”. **[Mac]**

Library

- [ ] ⌘E, and View › Toggle Library → the library hides and the top bar starts after the window buttons (no overlap); again → it shows. The choice is kept after relaunch. **[Mac]** for the window buttons.
- [ ] ⇧⌘F while the library is hidden → it shows, with the cursor in the search field.

Find, replace and occurrences

- [ ] Select a word, ⇧⌘L (Edit › Select All Occurrences) → every occurrence in the document is selected; typing replaces them all; ⌘Z → **record** whether one undo restores all.
- [ ] Select a word, ⌘D several times, quickly (Edit › Select Next Occurrence) → each press adds one more occurrence.
- [ ] ⌘F (Edit › Find and Replace…) → the Find field has the cursor; type, click the Replace field, type, ⌥⌘Return → every match replaced. Edit › Replace All with the mouse → the same.
- [ ] With “match case”, “regexp” and “by word” ticked in the panel → Replace All follows them.
- [ ] Each of ⌘F, ⌘D, ⇧⌘L and ⌥⌘Return pressed once in the editor → runs once, not twice (both the menu and the editor know these keys). **[Mac]**
- [ ] The same commands from the menu while the library has focus → they act on the open document.

Hyphens in tables

- [ ] Type `| --- | :--: |`, then `| 1990--2000 | x |` → the hyphens stay as typed; `A -- B` on a line without `|` → “A – B”.
- [ ] Paste a table containing `--` → unchanged. Edit › Convert Quotes and Dashes → hyphens in table rows unchanged; straight quotes in cells become curly.

Layout

- [ ] No line under the top bar or above the bottom bar; the bars keep their background colour. A line above the library search field, which has a search icon and no box of its own; when it has the cursor, the line and icon turn the accent colour. (0.9.5)
- [ ] The search field's text and the bottom bar's text sit on the same line.
- [ ] Narrow the window slowly with a document open → “· N characters” in the bottom bar stays until the bar has no room left, then goes as a whole (never cut off); widening brings it back. (0.9.5)
- [ ] Editor text is 22 px for a user who never changed the size (Settings shows 22); a size chosen earlier is kept. The text column is about 10% wider than in 0.5.1.
- [ ] The top bar has no PDF button; File › Export PDF… (⇧⌘E) and the library's right-click › Export PDF… still work.
- [ ] Preview (⌘R) → the grey around the pages is the same grey as the editor's background.

Side panel (0.6.1)

- [ ] Open Assistant, Insights or History → the panel runs from the top of the window to the bottom in the darker grey; the main top bar stops at the panel's edge.
- [ ] While open, Assistant, Insights and History are tabs at the top of the panel, in the same place the buttons were; the open one is highlighted. Click another → the panel switches; click the open one → the panel closes and the buttons return to the top bar.
- [ ] Scroll a long History list, a long chat, and Insights → the content passes behind the panel's top bar, slightly visible through it; the tabs stay readable.
- [ ] Drag the window by the panel's top bar (not on a tab) → the window moves. **[Mac]**
- [ ] ⌥⌘K, ⇧⌘I, ⌥⌘H → open, switch and close the panel as before.
- [ ] VoiceOver on the panel tabs → read as tabs, with “selected” on the open one. **[Mac]**

Formatting and tables (0.6.2)

- [ ] Select a word, ⌘B → `**word**`; ⌘B again → `word`. Same with ⌘I (`*word*`) and ⌘M (`==word==`).
- [ ] ⌘B then ⌘I on one selection → `***word***`; ⌘B again → `*word*` (italic stays).
- [ ] ⌘M on bold-italic text, then ⌘B → the bold comes off from outside the marks: `*==word==*`.
- [ ] Cursor inside a word (nothing selected), ⌘B → the word is bolded and the cursor stays in it; cursor between words → `****` with the cursor in the middle.
- [ ] Several selections (⇧⌘L), ⌘M → each one marked.
- [ ] Format › Bold, Italic, Mark with the mouse → the same; with a CSS file open → a notice, nothing changes.
- [ ] Each of ⌘B, ⌘I and ⌘M pressed once → applies once, not twice (menu and editor both know these keys). **[Mac]**
- [ ] ⌘M no longer minimises; Window › Minimize is ⌥⌘M. **[Mac]**
- [ ] `==marked==` text → highlighted in the editor, the preview, the PDF and the web page; `a == b` with spaces → unchanged.
- [ ] Paste `|:--|:--|` followed by rows → the editor keeps rows on one line (table); the preview and PDF show a table with no header row; the text alignment from the colons is applied.
- [ ] A line of text directly above `|:--|:--|` → standard behaviour (the text becomes the header if the cell counts match, otherwise all stays text).
- [ ] VoiceOver in the exported PDF on a table without a header row → read as a table, without column headers. **[Mac]**

Assistant chats (0.6.3)

- [ ] Chat in a project, quit, relaunch, open the Assistant → the same conversation; the panel names the project.
- [ ] Open a document in another project → its own (empty) conversation; back to the first → the first conversation.
- [ ] Two documents of one project → one shared conversation; each message shows the document it was about where that changes.
- [ ] Open a theme's CSS or a guide → the Themes or Guides conversation; close all tabs (empty tab) → the library's conversation.
- [ ] Send a message, switch to a document in another project before the reply ends → the reply finishes in the first project's conversation.
- [ ] Close the Assistant while a reply streams, reopen → the reply is there.
- [ ] Clear Chat… → asks, then empties the conversation; Cancel keeps it.
- [ ] `.mdeditor/chat.json` exists in the project; History shows no new version for chat messages; Export ZIP… (with and without history) does not contain it; New Template from Project… does not copy it.
- [ ] Library in iCloud Drive or Dropbox, chat on one Mac → after syncing, the other Mac's panel shows the new turns without relaunching. **[Mac, two machines]**
- [ ] A very long chat (paste long texts several times) → requests still succeed; **record** whether the AI remembers the earliest messages (it should not, past about 60,000 characters).

Assistant changes to files (0.7.0, needs an API key)

- [ ] Ask the Assistant to tighten a paragraph of the open document → a change block names the file, shows the current text struck through and the new text; nothing changes in the document yet.
- [ ] Apply → the text changes in the editor, is selected, and is dimmed as AI-written (⇧⌘A); the block says Applied; ⌘Z undoes it (the block shows Apply again).
- [ ] Ask for changes to another file in the project (not open) → Apply opens it in a new tab and changes it there.
- [ ] Ask for a new file (“add a notes/next-steps.md with…”) → Create File creates it, opens it in a tab, marks its text as AI-written; the block says Created.
- [ ] A reply with several changes → Apply All (N) applies those not yet applied; the count drops as they are applied; the button goes when none are left.
- [ ] Edit the text a change refers to before applying → the block says it cannot be applied; nothing else changes.
- [ ] Ask it to change a file outside the project (e.g. “../Other/x.md”) or in `.mdeditor/` → the block says outside the project; Apply is off.
- [ ] Untick “Project files”, ask about another file → the Assistant says it cannot see it (it is not sent). Tick it again → it can.
- [ ] A reference file (References folder), ticked or not, is never sent as a project file; only its own checkbox sends it.
- [ ] Quotes: a change written with straight quotes applies to text typed with curly quotes.
- [ ] Applied changes save like typing and appear in the next automatic version in History.

Page breaks (0.7.1)

- [ ] `+++` on its own line between two paragraphs → the second starts a new page in the preview and the PDF; in the editor `+++` is coloured like a `---` rule.
- [ ] `+++` directly under a line of text (no blank line) → still a page break.
- [ ] `+++` in a code block, in `inline code`, or with text on the line (`a +++ b`) → shown as text, no break.
- [ ] A theme of your own without a `.page-break` rule → `+++` still breaks the page.
- [ ] Two `+++` in a row → **record** whether an empty page appears.
- [ ] Web page export → no visible mark where the page breaks were.

Built-in SBX theme (0.8.2, local builds with resources/private)

- [ ] First launch of 0.8.2 with your existing library → Themes has SBX; the other themes are unchanged. Delete SBX, relaunch → it does not come back.
- [ ] A document with `theme: SBX` → the preview shows Franklin Gothic (Book text, Demi bold, Heavy headings) on a Mac without those fonts installed; the footer shows the date, the studio and the page number.
- [ ] Export PDF → in Acrobat (File › Properties › Fonts) the FranklinGothic fonts are listed as embedded subsets. **[Mac]**

QA fixes (0.8.0)

- [ ] Type a sentence and press ⌘Q at once (within a second) → after relaunch the sentence is there. Same with ⇧⌘W (close window). **[Mac]**
- [ ] Give a document a Finder tag (red) in the library, type in it, wait for the save → the tag is still there in the library and in Finder. **[Mac]**
- [ ] A document set to read-only for others in Finder (Get Info) → after a save, its permissions are unchanged. **[Mac]**
- [ ] Two tabs with unsaved typing in the first: press ⌃Tab and type at once → nothing typed is lost; the first tab keeps its text.
- [ ] Edit a document in another app (TextEdit) while it has unsaved typing here → a notice says the other version is in History; History has a version named “Changed in another app”.
- [ ] ⌘K, ask for a rewrite, switch tab before Replace → the bar closes; the other document is not changed. Type above the selection while the AI writes → Replace changes the right text.
- [ ] Paste `[guide](https://example.com/a--b "Guide")` → the link keeps its hyphens and straight quotes. Type `"` around `*Hamlet*` → “*Hamlet*”.
- [ ] ⌘B with the cursor in “don’t” → the whole word is bold. Select “b” in `**a b c**` and press ⌘B → `**a** b **c**`.
- [ ] Export Web Page of a document with `<script>alert(1)</script>` → opening the page in Safari shows no alert. **[Mac]**
- [ ] A Latin-1 text file in a project → opening it shows a message; the file is not changed.
- [ ] Settings › Size: clear the field and type 16 → the size changes to 16; type 50 and leave the field → 28.

## 4. Across the app

Library and sidebar

- [ ] + menu: New File…, New Collection…, New Project…, New Project from Template…, New Template from Project… → created and listed.
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
- [ ] Front matter `tags:` as a list (`- news`, `- updates`) and a theme component `includes/tags.html` with `{% for tag in tags %}<li>{{ tag }}</li>{% endfor %}`, used as `{% include tags.html %}` → one item per tag in the preview and the PDF; `{{tags}}` in the text → `news, updates`. (0.9.1)
- [ ] A `Plants` folder in a project with `echinacea-purpurea.md` (front matter `common name`, `soil`, `water` only); a document with `plants:` listing “Echinacea Purpurea” and a component using `name | lookup: "Plants"` and `plant["common name"]` → the details show in the preview and the PDF; edit the plant file → the preview updates; a name with no file → listed in the problems before export. (0.9.2)
- [ ] Right-click in the editor › Insert Component… → the theme's components and Figure; Figure shows Image (with project images offered), Caption, Description, Width and Alignment with their help; the tag preview follows the fields; Insert on an empty line → the tag alone on its line; with “In the text” → at the cursor. Right-click the tag › Edit Component… → the values are filled in; Update changes the tag. A theme component without a description block → fields read from its template; one with a mistake in its block → the problem is shown. (0.9.3)
- [ ] Insert Component… → every field starts empty (no default values in fields, menus or hints); Image shows a Required badge; Insert with Image empty → the message names Image and its field is outlined; filling it in clears the outline. A component parameter used only in {% if %} → a Yes/No menu, empty at first and left out of the tag when empty; a parameter used without a default or check → marked Required. (0.9.4)
- [ ] The arrows in every menu (component dialog, Settings › AI effort and Add a service, Export PDF document and PDF list) and in suggestion fields (Settings › General editor font, component Image and variable fields) are centred vertically, 10 px from the right edge, with text not running under them. (0.9.4)

Preview

- [ ] The page field shows “X / Y”; type a page number and press Return → jumps to that page.
- [ ] Scrolling the editor and switching to the preview (and back) → the same place.
- [ ] Double-click a paragraph in the preview, edit, press Return → the markdown changes.
- [ ] Double-click a heading in the preview, Shift+Return, type, Return → the markdown heading has `<br>` and the preview shows two lines. (0.9.8)
- [ ] Double-click a table cell in the preview (body and header row), change its text, press Return → only that cell changes in the markdown; bold or code inside the cell keeps its markers. (0.9.7)
- [ ] Type `a|b` in a cell → the markdown has `a\|b` and the table keeps its columns. A cell with `\|` in the markdown → edit around it; the pipe stays escaped. (0.9.7)
- [ ] An empty cell, and a cell missing from a short row (`| a |` under a three-column header) → type text, Return → the row gets the text in that column. (0.9.7)
- [ ] Escape while editing a cell → the cell's text is put back; the markdown is unchanged. (0.9.7)
- [ ] Mermaid diagrams use the theme's font.

Themes and fonts

- [ ] New theme…, Duplicate…, Rename…, Move to Trash, Edit CSS with ⌘R to preview.
- [ ] Add Fonts… with TTF, OTF, WOFF and WOFF2 → `@font-face` rules added after any `@import`; the font is used in the preview and embedded in the PDF (check with Preview › Tools › Show Inspector, or `pdffonts`).

Export

- [ ] Export PDF… (⇧⌘E) → accessibility warnings for missing image descriptions and skipped heading levels; the PDF opens and is tagged (check with Acrobat's accessibility checker or PAC, if available).
- [ ] A document whose first heading is `##` → Export PDF shows “Tag headings from H1 for screen readers”, ticked; export → no warning about the first heading; Acrobat or PAC shows the headings as H1, H2…; the pages look as with the option unticked. Untick, export → H2, H3… and the first-heading warning. Reopen the dialog → the choice is kept for that document; a document starting with `#` shows no option. **[Mac]** (0.9.8)
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
- [ ] A read-only file (locked in Finder) → **record** behaviour.
- [ ] File and folder names with emoji, accents and long paths.

## 4a. Web app on tablets and phones (new in 0.10.0)

Build, host and connect as in [WEB.md](WEB.md). **[Web]** throughout; try an iPhone, an iPad (both ways round) and a desktop browser.

- [ ] First visit → “Where is your library?” → Dropbox → Sign in with Dropbox → back in the app, the folder list → open the Mac's library folder → Use This Folder → the collections and projects appear. Reload → it opens without asking.
- [ ] The same with Google Drive (sign-in pop-up; allow pop-ups if asked); a folder made from the setup gets a new library with the examples.
- [ ] Phone: the library button opens the library over the editor; choosing a file closes it; tapping outside closes it. ☰ shows the menus (File, Edit, …), Assistant, Insights, History and Storage…; submenus replace the list, with Back.
- [ ] iPad held upright: the library is a drawer; sideways: beside the editor, as on the Mac. The Assistant, Insights and History panels open over the editor when upright.
- [ ] Type in a document → the bottom bar shows Saving to Dropbox…, then Saved to Dropbox; on the Mac the file has the text after the Dropbox app syncs.
- [ ] Change the open document on the Mac → within 30 seconds (or on switching back to the browser tab) the web app shows the change.
- [ ] Edit the same document on the Mac and the phone before either syncs → a notice names the conflicted copy; the copy has the phone's text, the file the Mac's.
- [ ] Airplane mode, type, reload the page → the text is still there; the bar shows Offline: N changes kept on this device; network back → Saved to Dropbox.
- [ ] Google Drive after an hour → Sign in to Google Drive in the bottom bar → one click signs in; waiting changes go.
- [ ] Preview: pages fit the phone's width at first; theme fonts, images and inserted PDF pages show.
- [ ] Export PDF… → pages are laid out → Print or Save as PDF… → the browser's print dialog; Save as PDF (iPhone: Share › Save to Files) gives the same pages as the preview.
- [ ] Export Web Page…, Export ZIP…, Export Theme… → downloaded files.
- [ ] Settings › AI: paste a Claude key, Save → on another device (same Dropbox or Google account) the key is already set; the Assistant streams a reply.
- [ ] Touch and hold a library row or a tab → its menu; ⋯ in the top bar → the editor's menu (spelling, thesaurus, Insert, Ask AI) at the cursor.
- [ ] Add a file… (Export PDF) and Theme › Add Images… → a dialog with Choose Files…; the files are added. Drop a file from the desktop on a project row (desktop browser) → it is copied in.
- [ ] Move to Trash → the item is in Dropbox's deleted files (Google Drive: Trash). Show in Dropbox (Google Drive) → the item on the service's website.
- [ ] Add to Home Screen (iPhone/iPad) → opens full screen with the FD icon; the top and bottom bars clear the notch and the home indicator.
- [ ] Menu › Storage… → switch to the other service or folder → the app reloads with that library.

## 5. Covered by automated tests

These run on Linux under Xvfb (`npm test`, then the three end-to-end suites), so they do not exercise macOS services: Finder tags use a JSON stand-in, and the AI uses a local mock. Step names as printed by the suites:

- `apps/desktop/e2e/smoke.mjs`: library seeded; curly quotes while typing, straight inside HTML tags and code; autosave; preview renders pages with running headers; preview on the editor grey; +++ starts a new page, in any theme; layout (including no rules on the top and bottom bars, a rule and an icon at the search field, the search and bottom bar text lined up, the character count kept while there is room, 22 px type); tabs (including + as New File): click replaces the tab, ⌘-click and Open in New Tab add one, ⌘T, ⌘W, ⌃Tab, undo kept; ⌘E hides and shows the library; find and replace: select all occurrences, next occurrence, Replace All; hyphens stay hyphens in table rows; ⌘B, ⌘I, ⌘M, ==marked text==, a table that starts with a separator row; tables in the editor do not wrap, they scroll sideways as a whole; lists in the editor: markers at the text edge, item text and wrapped rows at a shared indent, nested items one step in, the file unchanged, typing at the start of item text and in an empty item, a drag in a wrapped row, no widgets in list lines; scroll sync between the editor and the preview; library search: names and text; text editing in the preview (including a table cell, an empty cell, and Shift+Return in a heading); line breaks in headings (Shift+Return, the backslash, the second row under the heading text, Backspace removes the <br>); Export PDF › Tag headings from H1 (ticked at first, saved per document, absent for a document starting at H1); new collection and new file from the + menu; drag and drop in the library (move, ⌥ copy, name taken with Keep Both and Stop, a file from Finder, a copy handed to Finder); Finder tag dots from the context menu; theme menu in the bottom bar; guides menu in the bottom bar; PDF export through the host API; history panel with checkpoint (including no PDF button, the panel at full height with its tabs in its own top bar and its content starting under it); new project from template; template from a project, then a project from that template; theme CSS editing; theme export and import, with images; library-level history for themes; theme-local font and margin-box image load through the asset protocol.
- `apps/desktop/e2e/writing.mjs`: configure an OpenAI-compatible service (mock); settings dialog; guides from project settings; typed dashes and grammar/style underlines; command bar writes at the cursor and records authorship; authorship view toggle; chat panel inserts a draft; reference files sent with requests; chats are kept per project, on disk; the Assistant proposes changes to project files, Apply and Apply All; insights; readability highlighting; rewrite a selection; thesaurus in the context menu; voice refinement proposal.
- `apps/web/e2e/web.mjs` (Chromium at phone and tablet sizes, against stand-ins for Dropbox and Google Drive): setup and Dropbox sign-in (PKCE); a new library set up in Dropbox; the library in a drawer on a phone; typing saved to Dropbox; a change made elsewhere shows up; offline changes kept, then sent; a conflicted copy for a file changed in both places, with a notice; preview images through the service worker; Export PDF laid out for the print dialog; AI key kept with the account, outside the library; Export Web Page downloaded; a reload starts from the saved tree; tablet layouts sideways and upright; Google Drive sign-in in a pop-up, library set up in Drive, edits and outside changes; no page errors.
- `apps/desktop/e2e/pdf.mjs`: export the fixture (which includes marked text, a table without a header row and a +++ page break) and the Feature Tour; diagrams in the theme font; accessibility warnings before export; theme components; PDF pages inserted, chosen and arranged; single-page web export; PDF tags; a document starting at level 2 tagged from H1 (and as written), with the pages compared (pdftoppm); veraPDF PDF/UA-1 (when `VERAPDF` is set).
