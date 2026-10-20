// Resolves which voice and style guides apply to the open document (document front
// matter overrides the project setting) and builds the AI writing context.

import { describeStyleGuide, parseStyleGuide, splitFrontMatter, type WritingContext } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { getState, setState, type ActiveGuides } from '../state/store';

export async function refreshActiveGuides(): Promise<ActiveGuides> {
  const { doc, projects, guides } = getState();
  let voiceName: string | undefined;
  let styleName: string | undefined;
  if (doc?.projectPath) {
    const meta = projects[doc.projectPath]?.meta ?? (await api.project.details(doc.projectPath).catch(() => null))?.meta;
    voiceName = meta?.voice;
    styleName = meta?.style;
  }
  if (doc?.kind === 'markdown') {
    const fm = splitFrontMatter(editorBridge.getText() ?? doc.initialText).data;
    if (typeof fm.voice === 'string') voiceName = fm.voice;
    if (typeof fm.style === 'string') styleName = fm.style;
  }
  const voiceInfo = voiceName ? guides.find((g) => g.kind === 'voice' && g.name === voiceName) : undefined;
  const styleInfo = styleName ? guides.find((g) => g.kind === 'style' && g.name === styleName) : undefined;
  const active: ActiveGuides = { voice: null, style: null };
  if (voiceInfo) {
    const text = await api.files.readText(voiceInfo.path).catch(() => null);
    if (text !== null) active.voice = { name: voiceInfo.name, path: voiceInfo.path, text };
  }
  if (styleInfo) {
    const text = await api.files.readText(styleInfo.path).catch(() => null);
    if (text !== null) active.style = { ...parseStyleGuide(styleInfo.name, text), path: styleInfo.path };
  }
  setState({ activeGuides: active });
  return active;
}

export function writingContext(): WritingContext {
  const { activeGuides, doc } = getState();
  return {
    voice: activeGuides.voice ? { name: activeGuides.voice.name, text: activeGuides.voice.text } : undefined,
    style: activeGuides.style ? { name: activeGuides.style.name, rules: describeStyleGuide(activeGuides.style), notes: activeGuides.style.notes } : undefined,
    documentName: doc?.name,
  };
}
