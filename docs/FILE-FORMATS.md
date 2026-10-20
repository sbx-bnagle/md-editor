# File formats

Everything is stored as plain files so the library can be browsed in Finder, synced, and opened in other editors.

## Library

```
<Library>/
  .mdeditor/library.json          {"format": 1, "created": "..."}
  Collections/<Collection>/<Project>/...
  Templates/<Template>/...
  Themes/<Theme>/theme.css        plus any fonts or images the theme references
  Guides/Voices/<Name>.md         voice guides
  Guides/Styles/<Name>.md         style guides (see STYLE-GUIDES.md)
```

- A **collection** is any folder in `Collections/`.
- A **project** is any folder inside a collection. Everything inside it (any depth of folders) belongs to the project.
- A **template** is a project folder in `Templates/`. New projects copy it, except its history.

## Project metadata

`<Project>/.mdeditor/project.json`

```json
{
  "format": 1,
  "kind": "project",
  "created": "2026-10-20T19:00:00.000Z",
  "theme": "Classic",
  "lastExport": "main.md"
}
```

`voice` and `style` name the project's guides. A document can override `theme`, `voice` and `style` in its front matter.

`<Project>/.mdeditor/ai-log.jsonl` records AI text accepted into the project's documents (time, document, model, prompt, text), one JSON object per line. *Refine from edits* uses it to compare drafts with how they read now.

Project-specific theme copies live in `<Project>/.mdeditor/themes/<Theme>/theme.css` and take precedence over the library theme with the same name.

## Documents

Markdown (CommonMark plus tables, strikethrough, footnotes, raw HTML). Optional YAML front matter:

```markdown
---
title: Annual Report
client: Acme
date: October 2026
theme: Modern        # overrides the project theme for this document
---
```

### Variables

- `{{name}}` in markdown is replaced with the value. Not replaced inside code spans or fenced code. `\{{name}}` produces a literal `{{name}}`.
- Nested YAML maps use dotted names: `client: {name: Acme}` → `{{client.name}}`; lists are joined with commas.
- Built-ins (front matter can override): `today` (e.g. October 20, 2026), `today-iso` (2026-10-20), `project`, `collection`, `filename`.
- Variables are not substituted inside front matter values (decided in iteration 2: front matter stays literal so other apps read the same values).
- A transcluded document inherits the including document's variables. Its own front matter overrides them for itself and the documents it includes.

### Content blocks (transclusion)

Follows iA's [Markdown Content Blocks](https://github.com/iainc/Markdown-Content-Blocks) spec v0.4, also accepting paths that start with `./` or `../`:

```
/Chapter 1.md
../shared/intro.md
/images/figure.png "Caption"
/data/sales.csv 'Table caption'
/code/example.py (Caption)
https://example.com/photo.jpg "Online image"
```

- The line must contain only the path and an optional title, indented by at most three spaces.
- Paths are relative to the folder of the document containing the line; a leading `/` means that folder, not the disk root.
- `.md`, `.markdown`, `.txt` and similar are rendered as markdown; images become figures; `.csv`/`.tsv` become tables (first row is the header); recognised code files become highlighted code blocks.
- Lines inside fenced code are ignored. Missing files, circular includes and unsupported types show a dashed box in the preview and are listed before PDF export.
- Paths must stay inside the project folder; a content block pointing outside it shows a box and a warning instead of the file, so history and ZIP exports always hold everything a document uses.

### Authorship annotations

Compatible with iA's [Markdown Annotations](https://github.com/iainc/markdown-annotations) v0.2: a block at the end of the file listing which character ranges were written by a human (`@`), by AI (`&`) or are references (`*`), with a SHA-256 hash of the text. The editor hides the block, keeps the ranges aligned as text is edited, and rewrites the block and hash on save. The block is never rendered in the preview or PDF.

- Text you type is attributed to `@<your name>` (Settings › General); text inserted from the AI to `&<model>`; pasted text is left unattributed because its author is unknown. Undo restores attribution along with the text.
- A block is written only to files that already have one or that contain AI text, so ordinary files stay unchanged.
- AI-written text is shown dimmed; ⇧⌘A or the status bar switches the dimming off and on. Settings › General can stop recording authorship.

If the hash does not match (the file was edited elsewhere), the ranges are kept and a notice says they may be misplaced.

## Version history

`<Project>/.mdeditor/history.mdh`: one append-only binary file per project, chosen over a git object store because a single file syncs more reliably through iCloud Drive, Dropbox or Google Drive.

```
file     = "MDEHIST1\n" record*
record   = type:u8  length:u32 (big-endian)  payload  crc32(type + payload):u32
type 1   = blob:     sha256 (32 bytes) + deflate(file content)
type 2   = snapshot: deflate(JSON)
```

Snapshot JSON:

```json
{ "id": "mgz…", "time": 1792523000000, "kind": "checkpoint", "name": "Sent to client",
  "parent": "mgy…", "files": { "main.md": { "h": "<sha256>", "s": 1234 } } }
```

- `kind`: `auto` (after 2 minutes without changes, and on quit), `checkpoint` (named by you), `export` (each PDF export), `restore`.
- Content is stored once per unique file content, so unchanged files and images cost nothing in later snapshots.
- Versioned: every project file plus `.mdeditor/project.json` and `.mdeditor/themes/`. Not versioned: other hidden files.
- A damaged tail (e.g. an interrupted write) is ignored and trimmed on the next write.
- Restoring a project or file first records the current state, so a restore can itself be undone.

## Settings

`~/Library/Application Support/MD Editor/settings.json`: library path, last open document, and preferences (author name, editor font, checks, AI services without keys).

`~/Library/Application Support/MD Editor/secrets.json`: API keys, each encrypted with Electron `safeStorage` (key held in the macOS Keychain).
