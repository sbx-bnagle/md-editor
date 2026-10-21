import { useEffect, useRef } from 'react';
import type { ContextMenuItem } from '@mde/core';
import { api } from '../api/host';
import { reportError } from '../state/actions';

/** Closes a popover on an outside click or Escape. Attach the returned ref to the anchor. */
export function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** Shows a native context menu and runs the handler for the chosen item. */
export async function nativeMenu(items: ContextMenuItem[], handlers: Record<string, () => void>): Promise<void> {
  try {
    const id = await api.ui.showContextMenu(items);
    if (id && handlers[id]) handlers[id]();
  } catch (e) {
    reportError(e);
  }
}

export const separator: ContextMenuItem = { type: 'separator' };
