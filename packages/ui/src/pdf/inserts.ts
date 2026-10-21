// Inserting PDF pages into documents: the sidebar's Insert into Document and the editor's
// Choose PDF Pages… (writes the #pages= selection into the content block line).

import type { EditorView } from '@codemirror/view';
import { contentBlockPath, formatPageSpec, parseContentBlock, parsePageSpec, paths, pdfBlockLine } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { reportError } from '../state/actions';
import { getState, setState, toast } from '../state/store';

/** The PDF content block on a 1-based line, if there is one. */
export function pdfBlockAt(view: EditorView, lineNumber: number) {
  const text = view.state.doc.line(lineNumber).text;
  const block = parseContentBlock(text);
  return block && block.kind === 'pdf' && !block.online ? { block, text } : null;
}

/** Adds a content block for `pdfPath` to the open document, below the cursor. */
export function insertPdfIntoDocument(pdfPath: string): void {
  const { doc } = getState();
  if (doc?.kind !== 'markdown' || !editorBridge.view || !doc.projectPath || !paths.isInside(pdfPath, doc.projectPath)) {
    toast('Open a document in the same project first.');
    return;
  }
  const rel = paths.relative(paths.dirname(doc.path), pdfPath);
  const target = rel.startsWith('../') ? rel : `/${rel}`;
  editorBridge.insertBlockLine(pdfBlockLine(target, '', paths.basename(pdfPath, '.pdf')));
  toast('Inserted every page. Right-click the line to choose pages; edit the quoted description for screen readers.');
}

/** Opens the page picker for the PDF block on `lineNumber` and writes the choice back. */
export async function choosePdfPages(view: EditorView, lineNumber: number): Promise<void> {
  const { doc } = getState();
  const found = pdfBlockAt(view, lineNumber);
  if (!found || doc?.kind !== 'markdown' || !doc.projectPath) return;
  const { block, text } = found;
  try {
    const abs = contentBlockPath(doc.path, block.target);
    const pdf = (await api.project.pdfs(doc.projectPath)).find((p) => p.path === abs);
    if (!pdf) return toast(`“${block.target}” was not found in the project.`);
    if (pdf.error || !pdf.pages) return toast(`“${block.target}”: ${pdf.error ?? 'no pages.'}`);
    const count = pdf.pages;
    setState({
      pagePicker: {
        name: block.title || paths.basename(block.target),
        url: pdf.url,
        count,
        pages: block.pages ? parsePageSpec(block.pages, count).pages : [],
        onDone: (pages) => {
          // The modal blocks editing, but the file may have been reloaded; only write if the line is unchanged.
          if (lineNumber > view.state.doc.lines) return;
          const line = view.state.doc.line(lineNumber);
          if (line.text !== text) return;
          const indent = /^ */.exec(text)?.[0] ?? '';
          view.dispatch({ changes: { from: line.from, to: line.to, insert: indent + pdfBlockLine(block.target, formatPageSpec(pages, count), block.title) }, userEvent: 'input.pdfpages' });
          view.focus();
        },
      },
    });
  } catch (e) {
    reportError(e);
  }
}
