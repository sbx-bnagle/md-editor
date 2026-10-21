// Mermaid diagrams: ```mermaid fences and .mmd / .mermaid content blocks. Core turns them into
// placeholders; the paged renderer (packages/ui/src/preview/diagrams.ts) draws them as SVG
// with the document theme's font. Mermaid's accTitle and accDescr become the figure's alt text.

import { escapeHtml } from './render/markdown';

export const DIAGRAM_EXTENSIONS = new Set(['.mmd', '.mermaid']);

const TYPES: Array<[RegExp, string]> = [
  [/^(graph|flowchart(-elk)?)\b/, 'Flowchart'],
  [/^sequenceDiagram\b/, 'Sequence diagram'],
  [/^classDiagram(-v2)?\b/, 'Class diagram'],
  [/^stateDiagram(-v2)?\b/, 'State diagram'],
  [/^erDiagram\b/, 'Entity relationship diagram'],
  [/^journey\b/, 'User journey'],
  [/^gantt\b/, 'Gantt chart'],
  [/^pie\b/, 'Pie chart'],
  [/^quadrantChart\b/, 'Quadrant chart'],
  [/^requirementDiagram\b/, 'Requirement diagram'],
  [/^gitGraph\b/, 'Git graph'],
  [/^C4\w*/, 'C4 diagram'],
  [/^mindmap\b/, 'Mind map'],
  [/^timeline\b/, 'Timeline'],
  [/^sankey(-beta)?\b/, 'Sankey diagram'],
  [/^xychart(-beta)?\b/, 'XY chart'],
  [/^block(-beta)?\b/, 'Block diagram'],
  [/^packet(-beta)?\b/, 'Packet diagram'],
  [/^kanban\b/, 'Kanban board'],
  [/^architecture(-beta)?\b/, 'Architecture diagram'],
  [/^radar(-beta)?\b/, 'Radar chart'],
];

export interface DiagramInfo {
  /** Kind of diagram in words, e.g. "Gantt chart". */
  kind: string;
  /** accTitle, or the diagram's own `title` line. */
  title?: string;
  /** accDescr (single line or { block }). */
  description?: string;
  /** True when the author wrote accTitle or accDescr. */
  hasAccessibleText: boolean;
}

export function diagramInfo(source: string): DiagramInfo {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  // Skip YAML front matter and blank or comment lines before the diagram keyword.
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
  }
  let kind = 'Diagram';
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('%%')) continue;
    kind = TYPES.find(([re]) => re.test(l))?.[1] ?? 'Diagram';
    break;
  }
  const accTitle = /^\s*accTitle\s*:\s*(.+)$/m.exec(source)?.[1].trim();
  const block = /^\s*accDescr\s*\{([\s\S]*?)\}/m.exec(source)?.[1];
  const accDescr = block !== undefined ? block.replace(/\s+/g, ' ').trim() : /^\s*accDescr\s*:\s*(.+)$/m.exec(source)?.[1].trim();
  const title = accTitle ?? /^\s*title\s+(.+)$/m.exec(source)?.[1].trim();
  return { kind, title, description: accDescr, hasAccessibleText: !!(accTitle || accDescr) };
}

/** Alt text for the diagram figure: title and description, else the caption, else its kind. */
export function diagramAlt(info: DiagramInfo, caption?: string): string {
  const parts = [info.title ?? caption, info.description].filter((p): p is string => !!p);
  return parts.length ? parts.join('. ') : info.kind;
}

/** True when a reader of the PDF gets a meaningful description of the diagram. */
export function diagramIsDescribed(info: DiagramInfo, caption?: string): boolean {
  return info.hasAccessibleText || !!caption;
}

/**
 * Placeholder the renderer replaces with SVG. role="img" makes it one Figure in the PDF tags
 * with the alt text; the figure element only groups it with its caption.
 */
export function diagramHtml(source: string, opts: { line?: number; caption?: string } = {}): string {
  const info = diagramInfo(source);
  const alt = escapeHtml(diagramAlt(info, opts.caption));
  const line = opts.line !== undefined ? ` data-src-line="${opts.line}"` : '';
  const caption = opts.caption ? `<figcaption>${escapeHtml(opts.caption)}</figcaption>` : '';
  return `<figure class="mde-diagram" role="group" data-break-inside="avoid"${line}><div class="mde-mermaid" role="img" aria-label="${alt}"><pre class="mde-diagram-source">${escapeHtml(source)}</pre></div>${caption}</figure>\n`;
}
