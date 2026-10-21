import { useEffect, useRef, useState } from 'react';
import type { RenderResult } from '@mde/core';
import { editorBridge } from '../editor/bridge';
import { applyPreviewEdit } from '../preview/edits';
import type { PreviewEditMessage } from '../preview/editing';
import { previewPosition } from '../preview/sync';
import { requestRender } from '../state/actions';
import { getState, setState, toast, useStore } from '../state/store';

interface Frame {
  key: number;
  render: RenderResult;
  ready: boolean;
}

let frameKey = 0;

/**
 * Paged.js can lay out a document only once per page load, so each render goes into a
 * fresh iframe that is shown once laid out (no flicker, scroll position kept).
 */
export function Preview() {
  const render = useStore((s) => s.render);
  const zoom = useStore((s) => s.zoom);
  const renderError = useStore((s) => s.renderError);
  const [frames, setFrames] = useState<Frame[]>([]);
  const refs = useRef(new Map<number, HTMLIFrameElement>());
  const scrollRatio = useRef<number | null>(null);
  // Source line at the top: from the editor when the preview opens, then from the preview's scrolling.
  const line = useRef<number | null>(getState().doc?.kind === 'markdown' ? editorBridge.topLine() : null);
  // Newest laid-out frame; its scroll reports arrive before React shows it.
  const shownKey = useRef<number | null>(null);
  // While text is being edited in the shown frame, newer frames wait instead of replacing it.
  const editingKey = useRef<number | null>(null);
  const deferred = useRef<{ key: number; pages: number } | null>(null);
  const visibleKey = frames.find((f) => f.ready)?.key;

  useEffect(() => {
    if (!render) return;
    const key = ++frameKey;
    setFrames((fs) => [...fs.filter((f) => f.ready).slice(-1), { key, render, ready: false }]);
  }, [render]);

  const show = (key: number, pages: number) => {
    shownKey.current = Math.max(shownKey.current ?? 0, key);
    setFrames((fs) => fs.map((f) => (f.key === key ? { ...f, ready: true } : f)).filter((f) => f.key >= key));
    setState({ rendering: false, pageCount: pages });
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const entry = [...refs.current.entries()].find(([, el]) => el.contentWindow === e.source);
      if (!entry) return;
      const [key, el] = entry;
      const msg = e.data as { type: string; [k: string]: unknown };
      if (msg.type === 'ready') {
        const frame = frames.find((f) => f.key === key);
        if (!frame) return;
        el.contentWindow!.postMessage(
          {
            type: 'render',
            id: key,
            html: frame.render.html,
            css: frame.render.css,
            title: frame.render.title,
            zoom,
            ...(line.current !== null ? { line: line.current } : scrollRatio.current !== null ? { ratio: scrollRatio.current } : {}),
          },
          '*',
        );
      } else if (msg.type === 'rendered') {
        if (editingKey.current !== null && editingKey.current !== key) {
          deferred.current = { key, pages: Number(msg.pages) };
          setState({ rendering: false });
        } else show(key, Number(msg.pages));
      } else if (msg.type === 'editing' && key === shownKey.current) {
        editingKey.current = msg.active ? key : null;
        const waiting = deferred.current;
        if (!msg.active && waiting) {
          deferred.current = null;
          show(waiting.key, waiting.pages);
        }
      } else if (msg.type === 'error') {
        setState({ rendering: false, renderError: String(msg.message) });
      } else if (msg.type === 'open-link' && typeof msg.url === 'string' && /^https?:/i.test(msg.url)) {
        // The window's open handler sends web links to the default browser.
        window.open(msg.url);
      } else if (msg.type === 'edit' && key === shownKey.current) {
        // Frames laid out before the edit are out of date; the edit triggers a new one.
        deferred.current = null;
        applyPreviewEdit(msg as unknown as PreviewEditMessage).then((error) => {
          if (!error) return;
          toast(error);
          el.contentWindow?.postMessage({ type: 'edit-failed' }, '*');
          requestRender();
        });
      } else if (msg.type === 'scroll' && key === shownKey.current) {
        scrollRatio.current = Number(msg.ratio);
        const doc = getState().doc;
        if (doc?.kind === 'markdown' && typeof msg.line === 'number') {
          line.current = msg.line;
          previewPosition.docPath = doc.path;
          previewPosition.line = msg.line;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frames, zoom]);

  useEffect(() => {
    for (const f of frames) if (f.ready) refs.current.get(f.key)?.contentWindow?.postMessage({ type: 'zoom', zoom }, '*');
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="preview-host">
      {renderError && <div className="preview-message">{renderError}</div>}
      {frames.map((f) => (
        <iframe
          key={f.key}
          ref={(el) => {
            if (el) refs.current.set(f.key, el);
            else refs.current.delete(f.key);
          }}
          className={`preview-frame${f.key === visibleKey ? ' visible' : ''}`}
          src="./preview.html"
          title="Themed preview"
          sandbox="allow-scripts allow-same-origin"
        />
      ))}
    </div>
  );
}
