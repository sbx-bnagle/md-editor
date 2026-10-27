import { useEffect, useRef, useState, type ReactNode } from 'react';
import { foldForSearch, paths, searchTerms, type LibrarySearchHit, type LibrarySearchResult } from '@mde/core';
import { api } from '../api/host';
import { editorBridge } from '../editor/bridge';
import { loadProject, openFile, reportError, setMode } from '../state/actions';
import { getState, setState, useStore } from '../state/store';
import { SearchIcon } from './icons';

/** Wraps the parts of `text` that match a search term in <mark>. */
function highlight(text: string, terms: string[]): ReactNode[] {
  const folded = foldForSearch(text);
  // Folding keeps lengths for precomposed text; if it did not, show the text plain.
  if (folded.length !== text.length) return [text];
  const marks: Array<[number, number]> = [];
  for (const t of terms) for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + t.length)) marks.push([i, i + t.length]);
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of marks) {
    if (from < at) continue;
    out.push(text.slice(at, from), <mark key={from}>{text.slice(from, to)}</mark>);
    at = to;
  }
  out.push(text.slice(at));
  return out;
}

/** Opens a result (⌘-click: in a new tab). */
async function openHit(hit: LibrarySearchHit, newTab: boolean, line?: number, terms: string[] = []) {
  try {
    if (hit.kind === 'file') {
      if (line !== undefined) {
        if (getState().doc?.path === hit.path) {
          setMode('edit');
          editorBridge.revealLine(line, terms[0]);
          return;
        }
        editorBridge.revealAfterOpen(hit.path, line, terms[0] ?? '');
        if (getState().mode === 'preview') setMode('edit');
      }
      await openFile(hit.path, { newTab });
      return;
    }
    // Collections, projects and folders: show them in the tree.
    const project = hit.projectPath ?? null;
    const open: Record<string, boolean> = { [hit.collectionPath]: true };
    if (project) open[project] = true;
    if (hit.kind === 'folder') {
      let dir = hit.path;
      while (project && dir !== project && paths.isInside(dir, project)) {
        open[dir] = true;
        dir = paths.dirname(dir);
      }
    }
    setState((s) => ({ expanded: { ...s.expanded, ...open }, selected: hit.path, librarySearch: { query: '', result: null } }));
    if (project) await loadProject(project);
  } catch (e) {
    reportError(e);
  }
}

/** Results grouped by project (collections first). */
function groups(hits: LibrarySearchHit[]): Array<{ title: string; hits: LibrarySearchHit[] }> {
  const map = new Map<string, LibrarySearchHit[]>();
  for (const h of hits) {
    const title = h.project ? `${h.collection} › ${h.project}` : 'Collections';
    if (!map.has(title)) map.set(title, []);
    map.get(title)!.push(h);
  }
  return [...map].map(([title, list]) => ({ title, hits: list }));
}

export function SearchResults() {
  const search = useStore((s) => s.librarySearch);
  const result = search.result;
  const terms = searchTerms(search.query);
  if (!result) return <div className="tree-empty">Searching…</div>;
  if (result.hits.length === 0) return <div className="tree-empty">Nothing matches “{search.query}”.</div>;
  return (
    <div className="search-results" aria-label={`Search results for ${search.query}`}>
      {groups(result.hits).map((g) => (
        <section key={g.title} className="search-group">
          <h3 className="search-group-title">{g.title}</h3>
          {g.hits.map((h) => (
            <div key={h.path} className="search-hit">
              <button className="search-hit-name" onClick={(e) => openHit(h, e.metaKey)} title={h.path}>
                {highlight(h.kind === 'collection' ? h.collection : h.kind === 'project' ? (h.project ?? '') : (h.rel ?? paths.basename(h.path)), terms)}
                {h.kind !== 'file' && <span className="search-hit-kind">{h.kind}</span>}
              </button>
              {h.lines?.map((l) => (
                <button key={l.line} className="search-hit-line" onClick={(e) => openHit(h, e.metaKey, l.line, terms)} title={`Line ${l.line + 1}`}>
                  {highlight(l.text, terms)}
                </button>
              ))}
            </div>
          ))}
        </section>
      ))}
      {result.truncated && <div className="tree-empty">Showing the first {result.hits.length} matches. Add words to narrow the search.</div>}
    </div>
  );
}

/** The search field at the bottom of the sidebar, under a rule. ⇧⌘F focuses it; Escape clears it. */
export function LibrarySearch() {
  const query = useStore((s) => s.librarySearch.query);
  const [draft, setDraft] = useState(query);
  const seq = useRef(0);

  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    const q = draft.trim();
    if (!q) {
      setState({ librarySearch: { query: '', result: null } });
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      setState((s) => ({ librarySearch: { query: q, result: s.librarySearch.query === q ? s.librarySearch.result : null } }));
      api.library
        .search(q)
        .then((result: LibrarySearchResult) => {
          if (n === seq.current) setState({ librarySearch: { query: q, result } });
        })
        .catch(reportError);
    }, 180);
    return () => clearTimeout(t);
  }, [draft]);

  return (
    <label className="sidebar-search">
      <SearchIcon className="sidebar-search-icon" />
      <input
        id="library-search"
        type="search"
        placeholder="Search the library"
        aria-label="Search the library (⇧⌘F)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft('');
        }}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
