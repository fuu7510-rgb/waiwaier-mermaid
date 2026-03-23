import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

export interface SearchDeps {
  getDiagram: () => ERDiagramJSON | null;
  getLayout: () => LayoutData | null;
  panToEntity: (entityName: string) => void;
}

export interface SearchState {
  query: string;
  matches: string[];
  currentIndex: number;
  filterMode: boolean;
}

export function createSearchState(): SearchState {
  return { query: '', matches: [], currentIndex: -1, filterMode: false };
}

export function search(state: SearchState, deps: SearchDeps, query: string): string[] {
  state.query = query;
  if (!query) {
    state.matches = [];
    state.currentIndex = -1;
    return [];
  }

  const diagram = deps.getDiagram();
  const layout = deps.getLayout();
  if (!diagram) return [];

  const lower = query.toLowerCase();
  const matches: string[] = [];

  for (const [name, entity] of Object.entries(diagram.entities)) {
    const label = layout?.labels?.[name] || entity.label || '';
    if (
      name.toLowerCase().includes(lower) ||
      label.toLowerCase().includes(lower) ||
      entity.attributes.some(a => a.name.toLowerCase().includes(lower))
    ) {
      matches.push(name);
    }
  }

  state.matches = matches;
  state.currentIndex = matches.length > 0 ? 0 : -1;

  if (state.currentIndex >= 0) {
    deps.panToEntity(matches[0]);
  }

  return matches;
}

export function nextMatch(state: SearchState, deps: SearchDeps): void {
  if (state.matches.length === 0) return;
  state.currentIndex = (state.currentIndex + 1) % state.matches.length;
  deps.panToEntity(state.matches[state.currentIndex]);
}

export function prevMatch(state: SearchState, deps: SearchDeps): void {
  if (state.matches.length === 0) return;
  state.currentIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length;
  deps.panToEntity(state.matches[state.currentIndex]);
}
