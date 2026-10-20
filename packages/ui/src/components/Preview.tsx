import { useEffect, useRef, useState } from 'react';
import type { RenderResult } from '@mde/core';
import { editorBridge } from '../editor/bridge';
import { runCommand } from '../state/actions';
import { setState, useStore } from '../state/store';

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
  const firstLine = useRef<number | null>(editorBridge.topLine());
  const visibleKey = frames.find((f) => f.ready)?.key;

  useEffect(() => {
    if (!render) return;
    const key = ++frameKey;
    setFrames((fs) => [...fs.filter((f) => f.ready).slice(-1), { key, render, ready: false }]);
  }, [render]);

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
            ...(firstLine.current !== null ? { line: firstLine.current } : scrollRatio.current !== null ? { ratio: scrollRatio.current } : {}),
          },
          '*',
        );
        firstLine.current = null;
      } else if (msg.type === 'rendered') {
        setFrames((fs) => fs.map((f) => (f.key === key ? { ...f, ready: true } : f)).filter((f) => f.key >= key));
        setState({ rendering: false, pageCount: Number(msg.pages) });
      } else if (msg.type === 'error') {
        setState({ rendering: false, renderError: String(msg.message) });
      } else if (msg.type === 'scroll' && key === visibleKey) {
        scrollRatio.current = Number(msg.ratio);
      } else if (msg.type === 'key' && msg.meta && String(msg.key).toLowerCase() === 'r') {
        runCommand('toggle-preview');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frames, zoom, visibleKey]);

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
