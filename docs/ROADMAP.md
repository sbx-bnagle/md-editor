# Roadmap

## Decisions so far

| Topic | Decision |
| --- | --- |
| Technology | Electron, with strict layer separation for later ports (see ARCHITECTURE.md) |
| Code location | github.com/sbx-bnagle/md-editor |
| Library storage | Plain Finder folders: `Collections/`, `Templates/`, `Themes/`, `Guides/` |
| Versioning | Automatic snapshots plus named checkpoints; one sync-friendly history file per project |
| Variables | YAML front matter per document; included documents inherit and can override locally |
| Theme variables | Main document's values, replaced per section in headers and footers |
| Export | Any markdown document in a project, chosen at export; ZIP with optional history |
| Themes | Library themes; a project can customise its own copy |
| Selection of theme, voice, style | Per project, overridable per document in front matter |
| Page size | US Letter in bundled themes |
| Curly quotes | As you type; straight in `< >`, code, `{{variables}}`, front matter, content block lines |
| Authorship | iA Writer Markdown Annotations format |
| AI | Claude plus any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, LM Studio) |
| AI interface | Inline command bar and a chat panel |
| Checking | Live and local (macOS spelling, Harper grammar, style rules) plus on-demand AI review |
| Style guides | Base + overrides (e.g. AP-like base with serial comma required), unofficial rule sets |
| Voice guides | Markdown prose, refined manually and through AI-suggested additions |
| Preview editing | Text edits only, written back to the markdown |
| Mac target | Apple Silicon |

## Iteration 1 (this version)

Library, editor, themed paged preview, variables, content blocks, curly quotes, spelling underlines, PDF and ZIP export, version history, theme CSS editing, authorship annotations preserved.

## Iteration 2

- **AI provider layer** (interface in core, implementations in backend): Anthropic Messages API and OpenAI-compatible chat completions. API keys in the macOS Keychain (Electron `safeStorage`). Model choice per provider.
- **Inline command bar** (⌘K): generate at the cursor or rewrite the selection; accept or reject. Inserted text is recorded as AI-authored (`&` annotation) and shown dimmer; text you type is recorded as yours (`@` annotation, name from settings).
- **Chat panel** with project context (current document, voice and style guide) and Insert buttons.
- **Voice guides** (`Library/Guides/Voices/*.md`) used as AI context; **Refine voice** compares AI output with your edits and proposes additions as a diff.
- **Style guides** (`Library/Guides/Styles/*.md`): front matter `base:` plus rule overrides, prose notes for AI review. Bundled unofficial bases: AP-like, Chicago-like, Oxford-like. Starter guides converted from the account's `garden-writing-style` and `sandbox-proposal-style` skills.
- **Underlines**: spelling (red), grammar via Harper (blue), style rules (purple), each with suggestions on right-click.
- **Review with AI**: flags style-guide breaks that need judgement, shown as underlines with explanations.

## Iteration 3

- Text editing in preview, mapped back to source lines (`data-src-line` attributes are already emitted), including text in included files.
- Scroll sync between editor and preview in both directions.
- History: pruning of old automatic versions; merging history files that diverged on two Macs (sync conflicts).
- Refinements from iterations 1–2 feedback.

## Open questions

1. Should content blocks that point outside the project folder be allowed (currently: allowed, with a warning; not versioned or zipped)?
2. App name, icon, and bundle identifier (currently “MD Editor”, Electron's default icon, `local.mdeditor.app`).
3. Signing and notarisation: an Apple Developer ID removes the Gatekeeper steps. Is one available?
4. Should variables be substituted inside other front matter values (e.g. `footer: "{{client}} – {{date}}"`)? Not supported yet.
5. Editor font: currently monospaced (SF Mono). Proportional option wanted?
6. Should the preview open beside the editor (split view) as an option, in addition to the toggle?

## Known limitations

- Paged.js (0.4.3, last stable release July 2023) handles the layout; complex CSS (floats across pages, footnotes as page-bottom notes) has gaps. It is isolated behind one module.
- Spelling uses Chromium's spellchecker, which on macOS uses the system dictionary. Grammar and style checking arrive in iteration 2.
- Fonts referenced by name must be installed on the Mac; theme-bundled fonts load from the theme folder.
- The app is unsigned; see README for the one-time steps.
