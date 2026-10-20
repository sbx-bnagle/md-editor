# Roadmap

## Decisions so far

| Topic | Decision |
| --- | --- |
| Technology | Electron, with strict layer separation for later ports (see ARCHITECTURE.md) |
| Code location | github.com/sbx-bnagle/md-editor |
| App name, bundle id | Placeholders for now (“MD Editor”, `local.mdeditor.app`) |
| Signing | Ad-hoc only; a Developer ID is not needed until the app is distributed to others |
| Library storage | Plain Finder folders: `Collections/`, `Templates/`, `Themes/`, `Guides/` |
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
| Interface | IBM Plex Sans; neutral dark palette; sentence case; icons only for projects (filled folder) and folders (outlined) |
| Editor font | IBM Plex Mono by default; any installed font can be chosen in Settings. iA Writer's fonts are not bundled: iA's guidelines ask editors not to bundle them or use them as defaults |
| AI | Claude (default `claude-opus-5-5`) plus any OpenAI-compatible endpoint |
| AI interface | Inline command bar (⌘K) and a chat panel |
| Checking | Live and local (macOS spelling, Harper grammar, style rules) plus on-demand AI review |
| Style guides | Base + overrides on unofficial AP-like, Chicago-like and Oxford-like bases |
| Voice guides | Markdown prose, refined manually and through AI-proposed changes from edits |
| Preview editing | Text edits only, written back to the markdown |
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

## Iteration 3 (planned)

- **Accessible PDF**: document language, title shown in the window title bar, headers and footers marked as artifacts (out of the reading order), required alt text for images (title or alt), table header cells, bookmarks from headings, and a pre-export accessibility report. Validation with veraPDF (PDF/UA-1 machine-checkable rules) in the test suite; manual checks still needed for reading order and alt text quality.
- **Diagrams with Mermaid** (MIT): Gantt charts, flowcharts, timelines and more as ```` ```mermaid ```` blocks or `.mmd` content blocks, rendered to SVG in preview and PDF, themed from the document theme, with an accessible title and description.
- Text editing in preview, mapped back to source lines (including text from included files).
- Scroll sync between editor and preview in both directions.
- History: pruning of old automatic versions; merging history files that diverged on two Macs; version history for library-level files (themes, guides).
- Refinements from iteration 2 feedback.

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
- The app is unsigned; see README for the one-time steps.
