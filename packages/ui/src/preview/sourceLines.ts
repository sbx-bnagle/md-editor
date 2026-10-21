// Maps between source lines and positions in the laid-out preview, for scroll sync.
// Lines are 0-based and fractional: 12.5 is halfway through line 12 towards the next tagged line.
// Content from included files maps to the include line of the main document. Paged.js splits
// long elements across pages; the pieces keep the attribute and are treated as one run.

interface Anchor {
  el: HTMLElement;
  line: number;
}

function anchors(root: ParentNode): Anchor[] {
  const out: Anchor[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-src-line]')) {
    if (el.closest('.pagedjs_margin') || el.parentElement?.closest('.mde-include')) continue;
    out.push({ el, line: Number(el.getAttribute('data-src-line')) });
  }
  return out;
}

/** The pieces of one element (same line and tag), with their heights. */
function pieces(list: Anchor[], a: Anchor): Array<{ rect: DOMRect }> {
  return list.filter((b) => b.line === a.line && b.el.tagName === a.el.tagName).map((b) => ({ rect: b.el.getBoundingClientRect() }));
}

function nextLine(list: Anchor[], line: number): number {
  let next = Infinity;
  for (const a of list) if (a.line > line && a.line < next) next = a.line;
  return next;
}

/** Window y of a source line, or null when the document has no tagged elements. */
export function yForLine(root: ParentNode, line: number): number | null {
  const list = anchors(root);
  let at: Anchor | null = null;
  for (const a of list) {
    // The innermost element of the latest line at or before `line`.
    if (a.line <= line && (!at || a.line > at.line || (a.line === at.line && at.el.contains(a.el)))) at = a;
  }
  if (!at) return list.length ? list[0].el.getBoundingClientRect().top + window.scrollY : null;
  const next = nextLine(list, at.line);
  const frac = Math.min(1, Math.max(0, (line - at.line) / (Number.isFinite(next) ? next - at.line : 1)));
  const parts = pieces(list, at);
  const total = parts.reduce((s, p) => s + p.rect.height, 0);
  let offset = frac * total;
  for (const p of parts) {
    if (offset <= p.rect.height) return p.rect.top + offset + window.scrollY;
    offset -= p.rect.height;
  }
  return parts[0].rect.top + window.scrollY;
}

/** Source line at window y (default: the top of the viewport). */
export function lineAtY(root: ParentNode, y = 1): number {
  const list = anchors(root);
  let best: Anchor | null = null;
  let bestTop = -Infinity;
  for (const a of list) {
    const r = a.el.getBoundingClientRect();
    if (r.height <= 0) continue;
    if (r.top <= y && r.top >= bestTop) {
      best = a;
      bestTop = r.top;
    }
  }
  if (!best) return 0;
  const parts = pieces(list, best);
  const total = parts.reduce((s, p) => s + p.rect.height, 0);
  let offset = 0;
  for (const p of parts) {
    if (y < p.rect.top) break;
    offset += Math.min(p.rect.height, y - p.rect.top);
    if (y < p.rect.bottom) break;
  }
  const next = nextLine(list, best.line);
  const frac = total > 0 ? Math.min(1, offset / total) : 0;
  return best.line + frac * (Number.isFinite(next) ? next - best.line : 1);
}
