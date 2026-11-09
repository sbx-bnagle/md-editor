// Order and grouping of the open tabs, as pure functions over the tab list. A group's tabs are always
// next to each other; the group's label comes before its first tab. Every change keeps that true.

export interface GroupedTab {
  id: number;
  /** The tab's group, if it is in one. */
  group?: number;
}

/** Where a dragged tab or group lands: before the tab at `index` (in the list without what is dragged), in `group`. */
export interface Placement {
  index: number;
  group?: number;
}

/** What the pointer is over during a drag: a tab, a group's label, or the empty end of the bar. */
export type DropOver = { kind: 'tab'; id: number; after: boolean } | { kind: 'group'; id: number; after: boolean; collapsed: boolean } | { kind: 'end' };

const firstOf = <T extends GroupedTab>(tabs: T[], group: number) => tabs.findIndex((t) => t.group === group);
const lastOf = <T extends GroupedTab>(tabs: T[], group: number) => tabs.map((t) => t.group).lastIndexOf(group);
const withGroup = <T extends GroupedTab>(t: T, group: number | undefined): T => {
  if (group === undefined) {
    const { group: _drop, ...rest } = t;
    return rest as T;
  }
  return { ...t, group };
};

/**
 * Where a dragged tab lands. Before or after a tab, it joins that tab's group (between a group's
 * label and its first tab is inside the group). Before a group's label is outside it; after the
 * label is at the start of the group, or past the whole group when it is collapsed.
 */
export function placeTab<T extends GroupedTab>(tabs: T[], dragged: number, over: DropOver): Placement | null {
  const rest = tabs.filter((t) => t.id !== dragged);
  if (over.kind === 'end') return { index: rest.length };
  if (over.kind === 'tab') {
    if (over.id === dragged) return null;
    const i = rest.findIndex((t) => t.id === over.id);
    return i < 0 ? null : { index: over.after ? i + 1 : i, group: rest[i].group };
  }
  const first = firstOf(rest, over.id);
  // The group's own label, when the dragged tab is all there is in it.
  if (first < 0) return null;
  if (!over.after) return { index: first };
  return over.collapsed ? { index: lastOf(rest, over.id) + 1 } : { index: first, group: over.id };
}

/** Where a dragged group lands: never inside another group (a drop there goes before or after it). */
export function placeGroup<T extends GroupedTab>(tabs: T[], dragged: number, over: DropOver): number | null {
  const rest = tabs.filter((t) => t.group !== dragged);
  if (over.kind === 'end') return rest.length;
  const group = over.kind === 'group' ? over.id : tabs.find((t) => t.id === over.id)?.group;
  if (group === dragged) return null;
  if (group !== undefined) return over.after ? lastOf(rest, group) + 1 : firstOf(rest, group);
  const i = rest.findIndex((t) => over.kind === 'tab' && t.id === over.id);
  return i < 0 ? null : over.after ? i + 1 : i;
}

/** Moves a tab to a placement, giving it the placement's group (or none). */
export function moveTab<T extends GroupedTab>(tabs: T[], id: number, to: Placement): T[] {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return tabs;
  const rest = tabs.filter((t) => t.id !== id);
  const index = Math.max(0, Math.min(to.index, rest.length));
  return [...rest.slice(0, index), withGroup(tab, to.group), ...rest.slice(index)];
}

/** Moves a whole group so that it starts at `index` (in the list without the group's tabs). */
export function moveGroup<T extends GroupedTab>(tabs: T[], group: number, index: number): T[] {
  const members = tabs.filter((t) => t.group === group);
  const rest = tabs.filter((t) => t.group !== group);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), ...members, ...rest.slice(at)];
}

/** Puts a tab at the end of a group (a tab in another group leaves it). */
export function addToGroup<T extends GroupedTab>(tabs: T[], id: number, group: number): T[] {
  const rest = tabs.filter((t) => t.id !== id);
  const last = lastOf(rest, group);
  if (last < 0) return tabs.map((t) => (t.id === id ? withGroup(t, group) : t));
  return moveTab(tabs, id, { index: last + 1, group });
}

/** Takes a tab out of its group: it goes just after the group, so the group stays in one piece. */
export function removeFromGroup<T extends GroupedTab>(tabs: T[], id: number): T[] {
  const tab = tabs.find((t) => t.id === id);
  if (tab?.group === undefined) return tabs;
  const rest = tabs.filter((t) => t.id !== id);
  const last = lastOf(rest, tab.group);
  return moveTab(tabs, id, { index: last < 0 ? tabs.indexOf(tab) : last + 1 });
}

/** Puts a tab in a new group: in place when it had none, else just after its old group. */
export function newGroupFor<T extends GroupedTab>(tabs: T[], id: number, group: number): T[] {
  return removeFromGroup(tabs, id).map((t) => (t.id === id ? withGroup(t, group) : t));
}

/**
 * Moves a tab one step left (-1) or right (1), from the keyboard or the tab's menu: at the edge of
 * its group it first leaves the group; next to a group it first joins it (or passes a collapsed one).
 */
export function stepTab<T extends GroupedTab>(tabs: T[], id: number, step: 1 | -1, collapsed: (group: number) => boolean): T[] {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return tabs;
  const tab = tabs[i];
  const near = tabs[i + step];
  if (tab.group !== undefined && near?.group !== tab.group) {
    // Leaves its group, past the group's label (on the left) or at the group's end (on the right).
    return tabs.map((t) => (t.id === id ? withGroup(t, undefined) : t));
  }
  if (!near) return tabs;
  if (tab.group === undefined && near.group !== undefined) {
    const g = near.group;
    if (collapsed(g)) {
      const rest = tabs.filter((t) => t.id !== id);
      return moveTab(tabs, id, { index: step === 1 ? lastOf(rest, g) + 1 : firstOf(rest, g) });
    }
    return tabs.map((t) => (t.id === id ? withGroup(t, g) : t));
  }
  const out = [...tabs];
  out[i] = near;
  out[i + step] = tab;
  return out;
}

/** Keeps each group's tabs together (after the group's first tab) and drops groups that no tab names. */
export function tidyGroups<T extends GroupedTab, G extends { id: number }>(tabs: T[], groups: G[]): { tabs: T[]; groups: G[] } {
  const known = new Set(groups.map((g) => g.id));
  const out: T[] = [];
  const placed = new Set<number>();
  for (const t of tabs) {
    if (t.group === undefined || !known.has(t.group)) {
      out.push(t.group === undefined ? t : withGroup(t, undefined));
      continue;
    }
    if (placed.has(t.group)) continue;
    placed.add(t.group);
    out.push(...tabs.filter((m) => m.group === t.group));
  }
  return { tabs: out, groups: groups.filter((g) => placed.has(g.id)) };
}
