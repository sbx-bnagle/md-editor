import { describe, expect, test } from 'vitest';
import { addToGroup, dropOnto, moveGroup, moveTab, newGroupFor, placeGroup, placeTab, removeFromGroup, stepTab, tidyGroups, type GroupedTab } from '../src/state/tabOrder';

/** Tabs from a compact spec: "1 2a 3a 4" is tabs 1–4 with 2 and 3 in group 1 ("a"), "b" is group 2. */
const parse = (spec: string): GroupedTab[] =>
  spec.split(' ').map((s) => {
    const id = Number(s.replace(/[a-z]/g, ''));
    const g = s.match(/[a-z]/)?.[0];
    return g ? { id, group: g.charCodeAt(0) - 96 } : { id };
  });
const show = (tabs: GroupedTab[]) => tabs.map((t) => `${t.id}${t.group ? String.fromCharCode(96 + t.group) : ''}`).join(' ');

describe('tab order and groups', () => {
  test('a tab dropped beside another takes that tab’s group', () => {
    const tabs = parse('1 2a 3a 4');
    expect(show(moveTab(tabs, 4, placeTab(tabs, 4, { kind: 'tab', id: 2, after: false })!))).toBe('1 4a 2a 3a');
    expect(show(moveTab(tabs, 1, placeTab(tabs, 1, { kind: 'tab', id: 3, after: true })!))).toBe('2a 3a 1a 4');
    expect(show(moveTab(tabs, 2, placeTab(tabs, 2, { kind: 'tab', id: 4, after: true })!))).toBe('1 3a 4 2');
    expect(placeTab(tabs, 2, { kind: 'tab', id: 2, after: true })).toBeNull();
  });

  test('a group’s label: before it is outside, after it is inside (or past it when collapsed)', () => {
    const tabs = parse('1 2a 3a 4');
    expect(show(moveTab(tabs, 4, placeTab(tabs, 4, { kind: 'group', id: 1, after: false, collapsed: false })!))).toBe('1 4 2a 3a');
    expect(show(moveTab(tabs, 4, placeTab(tabs, 4, { kind: 'group', id: 1, after: true, collapsed: false })!))).toBe('1 4a 2a 3a');
    expect(show(moveTab(tabs, 1, placeTab(tabs, 1, { kind: 'group', id: 1, after: true, collapsed: true })!))).toBe('2a 3a 1 4');
    expect(show(moveTab(tabs, 1, placeTab(tabs, 1, { kind: 'end' })!))).toBe('2a 3a 4 1');
  });

  test('a group moves as a whole and never lands inside another group', () => {
    const tabs = parse('1 2a 3a 4 5b 6b');
    expect(show(moveGroup(tabs, 1, placeGroup(tabs, 1, { kind: 'tab', id: 4, after: true })!))).toBe('1 4 2a 3a 5b 6b');
    expect(show(moveGroup(tabs, 1, placeGroup(tabs, 1, { kind: 'tab', id: 5, after: true })!))).toBe('1 4 5b 6b 2a 3a');
    expect(show(moveGroup(tabs, 2, placeGroup(tabs, 2, { kind: 'tab', id: 3, after: false })!))).toBe('1 5b 6b 2a 3a 4');
    expect(show(moveGroup(tabs, 2, placeGroup(tabs, 2, { kind: 'group', id: 1, after: true, collapsed: false })!))).toBe('1 2a 3a 5b 6b 4');
    expect(placeGroup(tabs, 1, { kind: 'tab', id: 2, after: true })).toBeNull();
  });

  test('adding to, leaving and making groups keep each group in one piece', () => {
    const tabs = parse('1 2a 3a 4 5b');
    expect(show(addToGroup(tabs, 1, 1))).toBe('2a 3a 1a 4 5b');
    expect(show(addToGroup(tabs, 5, 1))).toBe('1 2a 3a 5a 4');
    expect(show(removeFromGroup(tabs, 2))).toBe('1 3a 2 4 5b');
    expect(show(removeFromGroup(tabs, 4))).toBe('1 2a 3a 4 5b');
    expect(show(newGroupFor(tabs, 4, 3))).toBe('1 2a 3a 4c 5b');
    expect(show(newGroupFor(tabs, 2, 3))).toBe('1 3a 2c 4 5b');
  });

  test('moving one step leaves or joins a group at its edge, and passes a collapsed one', () => {
    const tabs = parse('1 2a 3a 4');
    const open = () => false;
    expect(show(stepTab(tabs, 2, -1, open))).toBe('1 2 3a 4');
    expect(show(stepTab(tabs, 2, 1, open))).toBe('1 3a 2a 4');
    expect(show(stepTab(tabs, 3, 1, open))).toBe('1 2a 3 4');
    expect(show(stepTab(tabs, 4, -1, open))).toBe('1 2a 3a 4a');
    expect(show(stepTab(tabs, 1, 1, open))).toBe('1a 2a 3a 4');
    expect(show(stepTab(tabs, 1, 1, () => true))).toBe('2a 3a 1 4');
    expect(show(stepTab(tabs, 4, -1, () => true))).toBe('1 4 2a 3a');
    expect(show(stepTab(tabs, 1, -1, open))).toBe('1 2a 3a 4');
  });

  test('tidying drops empty groups and brings a group’s tabs together', () => {
    const { tabs, groups } = tidyGroups(parse('1a 2 3a 4c'), [{ id: 1 }, { id: 2 }]);
    expect(show(tabs)).toBe('1a 3a 2 4');
    expect(groups).toEqual([{ id: 1 }]);
  });
});

describe('dropping a tab onto another', () => {
  test('makes a group of the two, or joins the target’s group, just after the target', () => {
    const tabs = parse('1 2a 3a 4 5');
    const onto = (dragged: number, target: number) => {
      const r = dropOnto(tabs, dragged, target, 3);
      return `${show(r.tabs)}${r.created ? ' (new)' : ''}`;
    };
    expect(onto(5, 4)).toBe('1 2a 3a 4c 5c (new)');
    expect(onto(1, 5)).toBe('2a 3a 4 5c 1c (new)');
    expect(onto(4, 2)).toBe('1 2a 4a 3a 5');
    expect(onto(2, 4)).toBe('1 3a 4c 2c 5 (new)');
    expect(onto(4, 4)).toBe('1 2a 3a 4 5');
  });
});
