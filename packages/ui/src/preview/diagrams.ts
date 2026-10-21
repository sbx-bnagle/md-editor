// Draws Mermaid diagrams (placeholders from packages/core/src/diagrams.ts) as SVG before
// Paged.js lays out the pages. The diagrams use the document theme's text font and size, so
// they match the surrounding text in the preview and the PDF.
//
// Themes can adjust diagrams with custom properties on :root or html:
//   --diagram-font: "Inter", sans-serif;   default: the theme's paragraph font
//   --diagram-font-size: 13px;              default: 90% of the paragraph size
//   --diagram-theme: neutral;               a Mermaid theme: neutral (default), default, base, forest, dark

import { pageContentWidth } from '@mde/core';

interface DiagramStyle {
  fontFamily: string;
  fontSize: number;
  theme: string;
  /** Width of the page's text area: diagrams are laid out for it, so text is not scaled down. */
  width: number;
}

/** Applies the document CSS to a probe paragraph and reads the font the theme gives body text. */
async function themeStyle(css: string): Promise<{ style: DiagramStyle; host: HTMLElement; cleanup: () => void }> {
  const sheet = document.createElement('style');
  sheet.textContent = css;
  document.head.append(sheet);
  const width = pageContentWidth(css);
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;visibility:hidden`;
  probe.innerHTML = '<article class="mde-document"><p>Diagram font probe</p><div class="mde-diagram-host"></div></article>';
  document.body.append(probe);
  const p = probe.querySelector('p')!;
  const root = getComputedStyle(document.documentElement);
  const computed = getComputedStyle(p);
  const custom = (name: string) => root.getPropertyValue(name).trim();
  const paragraphSize = parseFloat(computed.fontSize) || 14;
  const style: DiagramStyle = {
    fontFamily: custom('--diagram-font') || computed.fontFamily,
    fontSize: parseFloat(custom('--diagram-font-size')) || Math.round(paragraphSize * 0.9 * 10) / 10,
    theme: custom('--diagram-theme') || 'neutral',
    width,
  };
  // Mermaid measures text while drawing: load the theme's font faces first.
  await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} ${style.fontSize}px ${style.fontFamily}`).catch(() => [])));
  return {
    style,
    host: probe.querySelector<HTMLElement>('.mde-diagram-host')!,
    cleanup: () => {
      probe.remove();
      sheet.remove();
    },
  };
}

/**
 * Removes parts of a drawing that lie entirely outside it (clipped, so invisible), such as a
 * Gantt chart's "today" line for a date outside the chart. Paged.js measures every element
 * when it looks for the end of a page and would otherwise break the page at them.
 */
function pruneOutside(svg: SVGSVGElement): void {
  const box = svg.getBoundingClientRect();
  if (!box.width || !box.height) return;
  for (const node of [...svg.querySelectorAll('g, path, line, rect, text, circle, polygon, polyline, ellipse, foreignObject')]) {
    if (!node.isConnected || node.closest('defs, marker, clipPath, mask, pattern, symbol')) continue;
    const r = node.getBoundingClientRect();
    if (r.left > box.right + 1 || r.top > box.bottom + 1 || r.right < box.left - 1 || r.bottom < box.top - 1) node.remove();
  }
}

let counter = 0;

/** Replaces every .mde-mermaid placeholder in `root` with its SVG; failures show the error in the page. */
export async function renderDiagrams(root: DocumentFragment, css: string): Promise<void> {
  const placeholders = [...root.querySelectorAll<HTMLElement>('.mde-mermaid')];
  if (!placeholders.length) return;
  const [{ default: mermaid }, { style, host, cleanup }] = await Promise.all([import('mermaid'), themeStyle(css)]);
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: style.theme as 'neutral',
      fontFamily: style.fontFamily,
      htmlLabels: false,
      themeVariables: { fontFamily: style.fontFamily, fontSize: `${style.fontSize}px` },
      flowchart: { useMaxWidth: true },
      gantt: { useMaxWidth: true, useWidth: style.width, fontSize: style.fontSize, sectionFontSize: style.fontSize, axisFormat: '%b %e' },
      sequence: { useMaxWidth: true },
    });
    for (const el of placeholders) {
      const source = el.querySelector('.mde-diagram-source')?.textContent ?? '';
      try {
        const { svg } = await mermaid.render(`mde-diagram-${++counter}`, source, host);
        // Measure in the probe (theme CSS, page text width), then move into the document.
        host.innerHTML = svg;
        const svgEl = host.querySelector('svg');
        if (svgEl) pruneOutside(svgEl);
        el.replaceChildren(...host.childNodes);
        if (svgEl) {
          // The SVG itself carries the alt text: Chromium tags an element that paints as a
          // Figure, and an img role keeps the drawing's text out of the reading order.
          for (const a of ['aria-labelledby', 'aria-describedby', 'aria-roledescription']) svgEl.removeAttribute(a);
          svgEl.setAttribute('role', 'img');
          svgEl.setAttribute('aria-label', el.getAttribute('aria-label') ?? 'Diagram');
          el.removeAttribute('role');
          el.removeAttribute('aria-label');
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        el.outerHTML = `<div class="mde-missing" role="note">Diagram error: ${message.split('\n')[0].replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</div>`;
      }
    }
  } finally {
    cleanup();
  }
}
