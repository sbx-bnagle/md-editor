# Voice and style guides

Guides live in the library as markdown files:

```
Library/Guides/Voices/<Name>.md    how the writing should sound (read by the AI)
Library/Guides/Styles/<Name>.md    mechanical rules (checked live) plus notes for the AI
```

Choose them for a project from the guides menu in the bottom bar, which also edits existing guides (right-click a guide there to duplicate, rename or remove it) and creates new ones. A document can override the project choice in its front matter:

```yaml
---
voice: Plain and direct
style: AP-like with serial comma
---
```

## Voice guides

Plain prose. Describe the reader, sentence length, word choice, and what to avoid. The AI reads the guide when it drafts, rewrites, chats, reviews, or suggests headlines.

**Refine from edits.** Open a voice guide (guides menu › Edit voice guide) and choose *Refine from edits…* in the top bar. Pick a project; the app compares AI drafts you accepted there (logged in the project's `.mdeditor/ai-log.jsonl`) with how those passages read now, and the AI proposes changes to the guide. You see the changes as a diff and apply or discard them.

## Style guides

Front matter chooses a base and overrides rules; the body holds notes for the AI reviewer.

```yaml
---
base: ap                 # ap | chicago | oxford | none
rules:
  serial-comma: required # override one rule of the base
replace:                 # word choices
  - use: toward
    not: [towards]
avoid:                   # words and phrases to flag
  - phrase: utilize
    suggest: use
patterns:                # regular expressions
  - match: '\bvery\s+\w+'
    message: Consider a stronger word.
reading-grade: 10        # target for readability highlighting
---
Notes for the AI reviewer: anything the rules cannot check.
```

### Bases

The bases are **unofficial and partial**. AP Stylebook, The Chicago Manual of Style, and New Hart's Rules are paid, copyrighted publications; the bases encode only a few widely known, mechanically checkable conventions associated with each, written for this app. Where a convention could not be stated with confidence, the rule is left off.

| Rule | AP-like | Chicago-like | Oxford-like |
| --- | --- | --- | --- |
| serial-comma | omit | required | required |
| numbers | spell-1-9 | spell-0-100 | spell-0-100 |
| em-dash | spaced | closed | off |
| range-dash | off | en-closed | en-closed |
| quotes | curly | curly | curly |
| quote-style | double | double | single |
| comma-in-quotes | inside | inside | off |
| spelling | us | us | oxford |
| percent | off | word | off |
| times | periods | periods | off |
| ampersand | avoid | off | off |
| double-space | flag | flag | flag |
| repeated-words | flag | flag | flag |

`base: none` starts with every rule off.

### Rules

| Rule | Values |
| --- | --- |
| `serial-comma` | `required` (comma before and/or in a list of three or more), `omit`, `off` |
| `numbers` | `spell-1-9` (one to nine in words, numerals from 10), `spell-0-100`, `numerals` (counts as numerals: 3 departments), `off` |
| `em-dash` | `closed` (no spaces), `spaced`, `avoid`, `off` |
| `range-dash` | `en-closed` (8–24), `off` |
| `quotes` | `curly` (flag straight quotes in prose), `off` |
| `quote-style` | `double` (double first, single inside), `single`, `off` |
| `comma-in-quotes` | `inside` (commas and periods inside the closing quote), `off` |
| `spelling` | `us`, `uk` (British, -ise), `oxford` (British with -ize), `off`; matched by stem, so inflected forms are caught |
| `percent` | `word` (“percent”), `symbol` (%), `off` |
| `units` | `closed` (7mm, 60%), `spaced` (7 mm), `off` |
| `times` | `periods` (9 a.m.), `closed` (9am), `off` |
| `ampersand` | `avoid` (write “and”, except in names), `off` |
| `heading-case` | `sentence`, `off` |
| `double-space` | `flag` (one space after a period), `off` |
| `repeated-words` | `flag` (“the the”), `off` |
| `wordy` | `flag` (in order to → to, prior to → before, …), `off` |

Rules check prose only: code, HTML tags, front matter, `{{variables}}`, URLs and content block lines are skipped. Some rules use heuristics (serial commas, numbers, sentence case) and can miss cases or flag correct text; each underline explains the rule so you can ignore it.

## Checks in the editor

| Underline | Source |
| --- | --- |
| Red wavy | Spelling, macOS dictionary |
| Blue wavy | Grammar, [Harper](https://github.com/Automattic/harper) (runs on this Mac, US English); its spelling and title-case rules are off because spelling and heading case come from the dictionary and the style guide |
| Purple wavy | Style guide rules |
| Amber dotted | AI review (Insights › Review with AI), until the next review or Clear |
| Tinted sentence | Readability: above the target grade (Settings › Checking, or `reading-grade`) |

Hover an underline for the explanation and suggested fixes.
