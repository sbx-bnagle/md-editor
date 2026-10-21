# Accessibility

## PDF

Exported PDFs are tagged for assistive technology and aim at PDF/UA-1 (ISO 14289-1).

### What the PDF contains

Chromium (`printToPDF` with `generateTaggedPDF`) writes the structure tree from the page's accessibility tree:

| Markdown | PDF tag |
| --- | --- |
| `#` … `######` | `H1` … `H6` |
| Paragraph | `P` |
| List | `L` › `LI` › `Lbl` (bullet or number) + `LBody` |
| `>` quotation | `BlockQuote` |
| Table, CSV content block | `Table` › `TR` › `TH` (column scope) / `TD` |
| Image with a description, Mermaid diagram | `Figure` with `Alt` |
| Link | `Link` with the link annotation |
| `*emphasis*`, `**strong**`, `` `code` `` | `Em`, `Strong` (mapped to `Span`), `Code` |

The app then post-processes the file (`packages/backend/src/pdfAccessibility.ts`):

- **Artifacts.** Page backgrounds, rules, borders and running headers, footers and page numbers are drawn without tags. They are marked as `Artifact`, so screen readers skip them. Content inside tagged diagrams is handled the same way (`packages/core/src/pdf/artifacts.ts`).
- **List bodies.** Chromium writes `LI` › `Lbl` + text; each item's text is wrapped in `LBody`.
- **Links** get a description (`Contents`): the URL, or "Link within this document".
- **Role map.** `Em` and `Strong` are PDF 2.0 types; they are mapped to `Span`, which PDF/UA-1 (based on PDF 1.7) accepts.
- **Metadata.** XMP metadata with the title, language and creator. Chromium already sets the document language (`lang` in front matter, default `en`) and shows the title in the window title bar.
- **PDF/UA identification** (`pdfuaid:part 1`) is added only when the pre-export check below finds nothing.

### Before export

The preview's problems list and the export dialog report:

- images without a description: write it in the brackets, `![A red square](red.png)`, or after a content block path, `/red.png "A red square"`;
- diagrams without a description: add `accTitle:` and `accDescr:` lines (or give a `.mmd` content block a title);
- a first heading that is not level 1, and headings that skip a level.

### Validation

`apps/desktop/e2e/pdf.mjs` exports a fixture with every block type (headings, lists, quotes, code, tables, images, diagrams, footnotes) in both bundled themes, plus the Feature Tour. It checks the tag structure and, when veraPDF is available, validates against the PDF/UA-1 profile. With veraPDF 1.28.2 all three files pass every PDF/UA-1 rule veraPDF checks (106 rules, 0 failures).

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

## Interface

Interface text meets WCAG 2 AAA contrast (7:1, success criterion 1.4.6) against the surfaces it appears on, including hover states, tinted highlights and selected text in the editor. `packages/ui/test/contrast.test.ts` reads the colour tokens from `app.css` and checks each pairing. Search matches and matching brackets are outlined, so the text over them keeps its contrast.
