# Accessibility

## PDF

Exported PDFs are tagged for assistive technology and aim at PDF/UA-1 (ISO 14289-1).

### What the PDF contains

Chromium (`printToPDF` with `generateTaggedPDF`) writes the structure tree from the page's accessibility tree:

| Markdown | PDF tag |
| --- | --- |
| `#` … `######` | `H1` … `H6` (see *Headings from H1* below) |
| Paragraph | `P` |
| List | `L` › `LI` › `Lbl` (bullet or number) + `LBody` |
| `>` quotation | `BlockQuote` |
| Table, CSV content block | `Table` › `TR` › `TH` (column scope) / `TD` |
| Image with a description, Mermaid diagram | `Figure` with `Alt` |
| Inserted PDF page | `Figure` with `Alt` ("Form W-9, page 1 of 3") |
| Link | `Link` with the link annotation |
| `*emphasis*`, `**strong**`, `` `code` `` | `Em`, `Strong` (mapped to `Span`), `Code` |

The app then post-processes the file (`packages/backend/src/pdfAccessibility.ts`):

- **Artifacts.** Page backgrounds, rules, borders and running headers, footers and page numbers are drawn without tags. They are marked as `Artifact`, so screen readers skip them. Content inside tagged diagrams is handled the same way (`packages/core/src/pdf/artifacts.ts`).
- **List bodies.** Chromium writes `LI` › `Lbl` + text; each item's text is wrapped in `LBody`.
- **Links** get a description (`Contents`): the URL, or "Link within this document".
- **Role map.** `Em` and `Strong` are PDF 2.0 types; they are mapped to `Span`, which PDF/UA-1 (based on PDF 1.7) accepts.
- **Metadata.** XMP metadata with the title, language and creator. Chromium already sets the document language (`lang` in front matter, default `en`) and shows the title in the window title bar.
- **Inserted PDF pages** (PDF content blocks and the export arrangement) replace the placeholder pages Chromium printed. Each page's form fields are flattened into it, the page's own tags (if any) are removed, and its whole content is wrapped in one marked-content sequence belonging to its `Figure`. Headers and footers are not printed on these pages.
- **PDF/UA identification** (`pdfuaid:part 1`) is added only when the pre-export check below finds nothing.

### Before export

The preview's problems list and the export dialog report:

- images without a description: write it in the brackets, `![A red square](red.png)`, or after a content block path, `/red.png "A red square"`;
- diagrams without a description: add `accTitle:` and `accDescr:` lines (or give a `.mmd` content block a title);
- a first heading that is not level 1 (unless the headings are tagged from H1, below), and headings that skip a level;
- inserted PDFs without a description, and inserted PDFs whose fonts are not embedded (PDF/UA requires embedded fonts; re-save the file with fonts embedded);
- components that show an image without alt text (for `figure.html`, give an `alt` or `caption`).

**Headings from H1.** A PDF/UA-1 file must start its headings with `H1` (veraPDF rule 7.4.2-1). When a document's first heading is lower, such as a chapter file that starts with `##`, the Export PDF dialog offers **Tag headings from H1 for screen readers**, ticked at first and saved for each document. Every heading then gets an `aria-level` that many levels higher (never above 1): level 2 is tagged `H1`, level 3 `H2`, and so on, with a lower heading later in the document also capped at `H1`. The elements stay `h2`, `h3`, so the theme styles them as before; the page looks the same (the PDF test compares the rendered pages). The export is then marked PDF/UA if nothing else stops it. Untick it to tag the headings as written. PDFs printed from the web app's browser are not tagged, so the option is shown in the Mac app only.

**Line breaks in headings.** Shift+Return in a heading writes `<br>` (a heading is one line of markdown). The heading keeps one tag; a space is added before the break so running headers and the PDF outline read “Planting guide Spring”, not “Planting guideSpring”.

Components shown on every page (`page-includes`, such as the footer) are hidden from assistive technology and marked as artifacts, like the theme's page numbers. Inline images inserted from the context menu carry their file name as the description until it is changed.

### Validation

`apps/desktop/e2e/pdf.mjs` exports a fixture with every block type (headings, lists, quotes, code, tables, images, diagrams, footnotes) in both bundled themes, the Feature Tour, a document with inserted PDF pages, and a document with components. It checks the tag structure and, when veraPDF is available, validates against the PDF/UA-1 profile. With veraPDF 1.28.2 all five files (the fifth uses components: a half-width figure, an inline image and a footer on every page) pass every PDF/UA-1 rule veraPDF checks (106 rules, 0 failures). The test also exports an arrangement with a form whose fonts are not embedded and checks that it is not marked PDF/UA.

```sh
npm run build
VERAPDF=verapdf xvfb-run -a node apps/desktop/e2e/pdf.mjs     # Linux; omit xvfb-run on a Mac
```

`VERAPDF` is the command that runs the veraPDF command line. Install veraPDF from verapdf.org, or fetch the Maven artifact `org.verapdf.apps:greenfield-apps:1.28.2` with its dependencies and use `VERAPDF="java -cp '/path/to/lib/*' org.verapdf.apps.GreenfieldCliWrapper"`.

### What a validator cannot check

veraPDF covers the machine-checkable rules. PDF/UA also needs human judgement, for example:

- descriptions that say what an image or diagram shows;
- link text that makes sense on its own;
- colour contrast in the theme;
- a reading order that follows the meaning (it follows the markdown order).

### Known limitations

- A paragraph or list that Paged.js breaks across pages becomes two `P` or `L` elements, one per page.
- Each page's content sits in its own `Art` element inside `Document`.
- Text inside a diagram is not read separately; the diagram is one figure with its description.
- An inserted PDF page is one figure: its text is not read out, only the description from the content block title or the arrangement (with "page 1 of 3"). Describe what the pages hold, or add the important content as text in the document.
- Of an inserted PDF, the app checks only that it can be read and that its fonts are embedded.

## Interface

The open documents are a tab list under the top bar: each tab is a button with the tab role and its selected state, and each has a labelled close button. ⌃Tab, ⇧⌘] and ⇧⌘[ move between tabs from the keyboard.

A table written without a header row is tagged as a table with rows and data cells only; screen readers announce no column headers for it. Give tables a header row where the columns need names.

While the side panel is open, Assistant, Insights and History are a tab list at the top of the panel (tab role, selected state); while it is closed they are buttons in the top bar. The panel's top bar is slightly see-through; the contrast test checks its text against white text scrolled behind it.

Interface text meets WCAG 2 AAA contrast (7:1, success criterion 1.4.6) against the surfaces it appears on, including hover states, tinted highlights and selected text in the editor. `packages/ui/test/contrast.test.ts` reads the colour tokens from `app.css` and checks each pairing. Search matches and matching brackets are outlined, so the text over them keeps its contrast.
