import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { tableScroll } from './tables';
import { editCommandKeymap, formatKeymap } from './editCommands';
import { MarkedText, markedTag } from './markedText';
import { HeaderlessTable } from './headerlessTables';
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap, lineNumbers, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { OpenKind } from '../state/store';
import { authorship } from './authorship';
import { smartQuotes } from './smartQuotes';
import { spellcheck, type SpellService } from './spellcheck';
import { syntaxDecorations } from './syntaxDecorations';
import { checks } from './checks';

const editorTheme = EditorView.theme(
  {
    '&': { color: 'var(--editor-text)', backgroundColor: 'transparent', height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--font-editor)', lineHeight: '1.75', overflow: 'auto' },
    '.cm-content': { caretColor: 'var(--accent)', padding: '48px 0 40vh' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)' },
    '.cm-panels': { backgroundColor: 'var(--bg-elev-2)', color: 'var(--text)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    // Search matches are outlined with a light fill so text over them keeps AAA contrast.
    '.cm-searchMatch': { backgroundColor: 'rgba(255, 200, 80, 0.06)', outline: '1px solid rgba(255, 200, 80, 0.55)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255, 200, 80, 0.06)', outline: '2px solid #ffc850' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(110, 168, 254, 0.08)', outline: '1px solid rgba(110, 168, 254, 0.45)', borderRadius: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(110, 168, 254, 0.08)', outline: '1px solid rgba(110, 168, 254, 0.6)' },
  },
  { dark: true },
);

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--editor-heading)', fontWeight: '700' },
  { tag: [t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--editor-heading)', fontWeight: '650' },
  { tag: t.strong, fontWeight: '700', color: 'var(--editor-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: markedTag, backgroundColor: 'rgba(255, 214, 102, 0.18)', borderRadius: '2px' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--editor-mark)' },
  { tag: [t.link, t.url], color: 'var(--editor-link)' },
  { tag: t.monospace, color: 'var(--editor-code)' },
  { tag: t.quote, color: 'var(--editor-quote)' },
  { tag: [t.angleBracket, t.tagName, t.attributeName, t.attributeValue], color: 'var(--editor-html)' },
  { tag: t.comment, color: 'var(--text-faint)' },
  { tag: t.list, color: 'var(--editor-mark)' },
]);

const cssHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.modifier], color: 'var(--code-keyword)' },
  { tag: [t.propertyName], color: 'var(--code-property)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: [t.number, t.unit], color: 'var(--code-number)' },
  { tag: [t.className, t.tagName, t.labelName], color: 'var(--code-class)' },
  { tag: [t.variableName, t.attributeName], color: 'var(--code-variable)' },
  { tag: t.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.bracket], color: 'var(--text-dim)' },
]);

export interface SetupOptions {
  kind: OpenKind;
  spell: SpellService;
  onChange: (state: EditorState) => void;
  onContextMenu: (view: EditorView, event: MouseEvent) => void;
}

export function editorExtensions(opts: SetupOptions): Extension[] {
  const common: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    search({ top: true }),
    highlightSelectionMatches(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    editCommandKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    editorTheme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state);
    }),
    EditorView.domEventHandlers({
      contextmenu: (event, view) => {
        event.preventDefault();
        opts.onContextMenu(view, event);
        return true;
      },
    }),
  ];
  if (opts.kind === 'markdown') {
    return [
      ...common,
      markdown({ base: markdownLanguage, addKeymap: true, extensions: [HeaderlessTable, MarkedText] }),
      formatKeymap,
      syntaxHighlighting(markdownHighlight),
      syntaxDecorations,
      tableScroll,
      smartQuotes,
      authorship,
      spellcheck(opts.spell),
      checks(),
      EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      EditorView.editorAttributes.of({ class: 'cm-prose' }),
    ];
  }
  if (opts.kind === 'css') {
    return [...common, css(), lineNumbers(), highlightActiveLine(), bracketMatching(), indentOnInput(), syntaxHighlighting(cssHighlight), EditorView.editorAttributes.of({ class: 'cm-code' })];
  }
  return [...common, lineNumbers(), EditorView.editorAttributes.of({ class: 'cm-code' })];
}
