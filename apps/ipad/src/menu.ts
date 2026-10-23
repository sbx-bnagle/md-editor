// Context menus on iPad, drawn in the page (the Mac app shows native menus). They open where
// the last pointer or touch was, take keyboard and touch input, and perform the four edit roles
// themselves (paste reads the clipboard through the shell).

import type { ContextMenuItem } from '@mde/core';
import { native } from './native';

let lastPoint = { x: 40, y: 40 };

/** Remembers where menus should open (call once). */
export function trackPointer(): void {
  const remember = (e: MouseEvent | PointerEvent) => (lastPoint = { x: e.clientX, y: e.clientY });
  window.addEventListener('pointerdown', remember, true);
  window.addEventListener('contextmenu', remember, true);
}

export function setMenuPoint(x: number, y: number): void {
  lastPoint = { x, y };
}

let closeOpen: (() => void) | null = null;

/** Shows `items` and resolves with the chosen item's id (null when dismissed or for a role). */
export function showMenu(items: ContextMenuItem[]): Promise<string | null> {
  closeOpen?.();
  // The element that had focus (the editor) keeps it, so cut, copy and paste act on its selection.
  const focusTarget = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'folio-menu-layer';
    const panels: HTMLElement[] = [];
    let done = false;

    const finish = (id: string | null) => {
      if (done) return;
      done = true;
      closeOpen = null;
      layer.remove();
      window.removeEventListener('keydown', onKey, true);
      focusTarget?.focus?.({ preventScroll: true });
      resolve(id);
    };
    closeOpen = () => finish(null);

    const closeFrom = (level: number) => {
      while (panels.length > level) panels.pop()!.remove();
    };

    const choose = (item: ContextMenuItem) => {
      if (item.role) {
        finish(null);
        void performRole(item.role, focusTarget);
      } else finish(item.id ?? null);
    };

    const openPanel = (list: ContextMenuItem[], level: number, x: number, y: number, anchor?: DOMRect) => {
      closeFrom(level);
      const panel = document.createElement('div');
      panel.className = 'folio-menu';
      panel.setAttribute('role', 'menu');
      for (const item of list) {
        if (item.type === 'separator') {
          const sep = document.createElement('div');
          sep.className = 'folio-menu-sep';
          sep.setAttribute('role', 'separator');
          panel.append(sep);
          continue;
        }
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'folio-menu-item';
        row.setAttribute('role', item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
        if (item.checked !== undefined) row.setAttribute('aria-checked', String(item.checked));
        row.disabled = item.enabled === false;
        const check = document.createElement('span');
        check.className = 'folio-menu-check';
        check.textContent = item.checked ? '✓' : '';
        row.append(check);
        if (item.color) {
          const dot = document.createElement('span');
          dot.className = 'folio-menu-dot';
          dot.style.background = item.color;
          row.append(dot);
        }
        const label = document.createElement('span');
        label.className = 'folio-menu-label';
        label.textContent = item.label ?? '';
        row.append(label);
        if (item.submenu) {
          const arrow = document.createElement('span');
          arrow.className = 'folio-menu-arrow';
          arrow.textContent = '›';
          row.append(arrow);
          row.setAttribute('aria-haspopup', 'menu');
        }
        // Keep focus (and the text selection) where it was.
        row.addEventListener('pointerdown', (e) => e.preventDefault());
        const openSub = () => {
          const r = row.getBoundingClientRect();
          openPanel(item.submenu!, level + 1, r.right - 4, r.top - 5, r);
          (panels[level + 1]?.querySelector('.folio-menu-item:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
        };
        row.addEventListener('click', () => (item.submenu ? openSub() : choose(item)));
        row.addEventListener('pointerenter', (e) => {
          if (e.pointerType !== 'mouse') return;
          if (item.submenu) openSub();
          else closeFrom(level + 1);
        });
        row.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' && item.submenu) {
            e.preventDefault();
            openSub();
          }
        });
        panel.append(row);
      }
      layer.append(panel);
      panels[level] = panel;
      // Keep the panel on screen: flip to the left of its parent item, or up, when it does not fit.
      const r = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = x;
      let top = y;
      if (left + r.width > vw - 8) left = anchor ? Math.max(8, anchor.left - r.width + 4) : Math.max(8, vw - r.width - 8);
      if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };

    const onKey = (e: KeyboardEvent) => {
      const items = (panel: HTMLElement | undefined) => (panel ? [...panel.querySelectorAll<HTMLElement>('.folio-menu-item:not(:disabled)')] : []);
      const current = document.activeElement as HTMLElement | null;
      const level = panels.findIndex((p) => p.contains(current));
      const list = items(panels[level >= 0 ? level : panels.length - 1]);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (level > 0) {
          closeFrom(level);
          (panels[level - 1]?.querySelector(':focus-within, .folio-menu-item') as HTMLElement | null)?.focus();
        } else finish(null);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const i = list.indexOf(current!);
        const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length] ?? list[0];
        next?.focus({ preventScroll: true });
      } else if (e.key === 'ArrowLeft' && level > 0) {
        e.preventDefault();
        closeFrom(level);
      } else if (e.key === 'Tab') {
        e.preventDefault();
      }
    };

    layer.addEventListener('pointerdown', (e) => {
      if (e.target === layer) {
        e.preventDefault();
        finish(null);
      }
    });
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    openPanel(items, 0, lastPoint.x, lastPoint.y);
  });
}

/** Cut, copy, paste and select all for the element that had focus when the menu opened. */
async function performRole(role: NonNullable<ContextMenuItem['role']>, target: HTMLElement | null): Promise<void> {
  target?.focus?.({ preventScroll: true });
  if (role === 'copy' || role === 'cut') {
    document.execCommand(role);
    return;
  }
  if (role === 'selectAll') {
    // CodeMirror draws only the visible lines, so its own command selects the whole document.
    if (target?.closest('.cm-editor')) target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: true, bubbles: true, cancelable: true }));
    else document.execCommand('selectAll');
    return;
  }
  const text = await native<string | null>('clipboard.read').catch(() => null);
  if (text) document.execCommand('insertText', false, text);
}

/**
 * Touch and hold on the library, tabs and other controls opens their menu, as a right-click
 * does (text in the editor keeps the system's own touch and hold: selection and the edit menu).
 */
export function longPressMenus(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number; target: Element } | null = null;
  let suppressClickUntil = 0;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      const target = e.target as Element | null;
      if (!target || target.closest('[contenteditable="true"], input, textarea, select, .folio-menu-layer')) return;
      cancel();
      start = { x: e.clientX, y: e.clientY, target };
      timer = setTimeout(() => {
        if (!start) return;
        const { x, y, target: t } = start;
        cancel();
        setMenuPoint(x, y);
        suppressClickUntil = Date.now() + 800;
        t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
      }, 500);
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    },
    true,
  );
  window.addEventListener('pointerup', cancel, true);
  window.addEventListener('pointercancel', cancel, true);
  // The tap that ends a touch and hold is not also a click on the row.
  window.addEventListener(
    'click',
    (e) => {
      if (Date.now() < suppressClickUntil && !(e.target as Element | null)?.closest('.folio-menu-layer')) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickUntil = 0;
      }
    },
    true,
  );
}

/** Opens the editor's menu at the text selection (the shell's "More…" item in the edit menu). */
export function menuAtSelection(): void {
  const sel = window.getSelection();
  const editor = (document.activeElement as HTMLElement | null)?.closest('.cm-content') ?? document.querySelector('.cm-content');
  if (!editor) return;
  const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : editor.getBoundingClientRect();
  const x = Math.round(rect.left + 1);
  const y = Math.round(rect.top + rect.height / 2);
  setMenuPoint(x, Math.round(rect.bottom + 4));
  editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
}
