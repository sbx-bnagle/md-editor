// Printing and web page export in the browser. The document is laid out in print.html (the same
// page the Mac app prints), in a frame: for a PDF the user then prints it with the browser's own
// print dialog (Save as PDF), so the PDF is the browser's: without the Mac app's tags for screen
// readers, and without PDFs arranged before or after the document.

interface PrintInput {
  html: string;
  css: string;
  title: string;
  lang: string;
}

type PrintWindow = Window & {
  __mdeRender?: (input: PrintInput & { print: boolean }) => Promise<unknown>;
  __mdeRenderWeb?: (input: PrintInput) => Promise<string>;
};

/** Loads print.html in a frame inside `parent` (a frame that is moved afterwards loads again). */
async function printFrame(visible: boolean, parent: HTMLElement = document.body): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe');
  frame.src = 'print.html';
  frame.title = 'Print layout';
  frame.className = visible ? 'folio-print-frame' : 'folio-print-frame hidden';
  parent.append(frame);
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('The print layout could not be loaded.'));
  });
  const win = frame.contentWindow as PrintWindow;
  for (let i = 0; i < 200 && !win.__mdeRender; i++) await new Promise((r) => setTimeout(r, 25));
  return frame;
}

/** The single-page HTML of a document (Export Web Page). */
export async function renderWebPage(input: PrintInput): Promise<string> {
  const frame = await printFrame(false);
  try {
    const render = (frame.contentWindow as PrintWindow).__mdeRenderWeb;
    if (!render) throw new Error('The print layout is not available.');
    return await render(input);
  } finally {
    frame.remove();
  }
}

/** Lays the document out in pages and offers the browser's print dialog (to print or save a PDF). */
export async function printDocument(input: PrintInput, note: string | null): Promise<void> {
  const layer = document.createElement('div');
  layer.className = 'folio-print-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', `Print “${input.title}”`);
  const bar = document.createElement('div');
  bar.className = 'folio-print-bar';
  const status = document.createElement('span');
  status.className = 'folio-print-status';
  status.textContent = 'Laying out pages…';
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'button', textContent: 'Close' });
  const print = Object.assign(document.createElement('button'), { type: 'button', className: 'button primary', textContent: 'Print or Save as PDF…', disabled: true });
  bar.append(status, close, print);
  layer.append(bar);
  document.body.append(layer);
  close.onclick = () => layer.remove();
  const frame = await printFrame(true, layer);
  try {
    await (frame.contentWindow as PrintWindow).__mdeRender!({ ...input, print: true });
    status.textContent = note ?? 'Choose Save as PDF (or Save to Files) in the print dialog to keep a PDF.';
    print.disabled = false;
    print.onclick = () => frame.contentWindow?.print();
    print.focus();
  } catch (e) {
    status.textContent = `The document could not be laid out: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export const PRINT_CSS = `
.folio-print-frame.hidden { position: fixed; left: -10000px; top: 0; width: 900px; height: 1200px; visibility: hidden; }
.folio-print-layer { position: fixed; inset: 0; z-index: 9000; display: flex; flex-direction: column; background: var(--bg, #1a1b1d); }
.folio-print-bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 14px; padding-top: max(10px, env(safe-area-inset-top)); border-bottom: 1px solid var(--border, #333); }
.folio-print-status { flex: 1; color: var(--text-dim, #c3c5ca); font-size: 13px; }
.folio-print-layer .folio-print-frame { flex: 1; width: 100%; border: 0; background: #7d8087; }
`;
