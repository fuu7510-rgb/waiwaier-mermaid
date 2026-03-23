import type { ERDiagramJSON } from '../parser/types.js';

export interface HighlightState {
  selectedEntity: string | null;
}

export interface HighlightDeps {
  getDiagram: () => ERDiagramJSON | null;
  getSvg: () => SVGSVGElement;
  showToast: (msg: string) => void;
}

export function createHighlightState(): HighlightState {
  return { selectedEntity: null };
}

export function handleEntityClick(
  state: HighlightState,
  deps: HighlightDeps,
  target: SVGElement,
  entityName: string,
): void {
  // Text copy
  const textEl = target.tagName === 'text' ? target : target.closest('text');
  if (textEl) {
    let copyText = '';
    if (textEl.classList.contains('entity-name')) {
      copyText = entityName;
    } else if (textEl.classList.contains('attr-name')) {
      copyText = textEl.textContent || '';
    } else if (textEl.classList.contains('attr-type')) {
      copyText = textEl.textContent || '';
    } else if (textEl.classList.contains('attr-key')) {
      copyText = textEl.textContent || '';
    } else if (textEl.classList.contains('attr-comment')) {
      copyText = textEl.textContent || '';
    }
    if (copyText) {
      navigator.clipboard.writeText(copyText).then(() => {
        deps.showToast(`Copied: ${copyText}`);
      });
    }
  }

  // Highlight toggle
  if (state.selectedEntity === entityName) {
    clearHighlight(state, deps);
  } else {
    highlightRelated(state, deps, entityName);
  }
}

/**
 * Build directed parent/child maps from relationships.
 * In ER cardinality, the "one" side (entityA with ||) is the parent,
 * the "many" side (entityB with o{ / |{) is the child.
 */
export function buildDirectedGraph(diagram: ERDiagramJSON | null): {
  parents: Map<string, Set<string>>;
  children: Map<string, Set<string>>;
} {
  if (!diagram) return { parents: new Map(), children: new Map() };
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  for (const name of Object.keys(diagram.entities)) {
    parents.set(name, new Set());
    children.set(name, new Set());
  }
  for (const rel of diagram.relationships) {
    // entityA (cardA) --  -- (cardB) entityB
    // "many" side is the child, "one" side is the parent
    const aIsParent = rel.cardinalityA.max === 'one';
    const bIsParent = rel.cardinalityB.max === 'one';
    if (aIsParent && !bIsParent) {
      // A is parent, B is child
      children.get(rel.entityA)?.add(rel.entityB);
      parents.get(rel.entityB)?.add(rel.entityA);
    } else if (bIsParent && !aIsParent) {
      // B is parent, A is child
      children.get(rel.entityB)?.add(rel.entityA);
      parents.get(rel.entityA)?.add(rel.entityB);
    } else {
      // Both one-to-one or many-to-many: treat as bidirectional
      children.get(rel.entityA)?.add(rel.entityB);
      children.get(rel.entityB)?.add(rel.entityA);
      parents.get(rel.entityA)?.add(rel.entityB);
      parents.get(rel.entityB)?.add(rel.entityA);
    }
  }
  return { parents, children };
}

export function highlightRelated(
  state: HighlightState,
  deps: HighlightDeps,
  entityName: string,
): void {
  state.selectedEntity = entityName;
  const { parents, children } = buildDirectedGraph(deps.getDiagram());

  const distances = new Map<string, number>();
  const treeEdges = new Set<string>();
  distances.set(entityName, 0);

  function addEdge(a: string, b: string): void {
    treeEdges.add(a + '\0' + b);
    treeEdges.add(b + '\0' + a);
  }

  // Traverse up (child → parent → grandparent → ...)
  // At each ancestor, also walk down its children to capture sibling chains
  function walkUp(node: string, depth: number): void {
    for (const parent of parents.get(node) || []) {
      if (!distances.has(parent)) {
        distances.set(parent, depth);
        addEdge(node, parent);
        walkUp(parent, depth + 1);
        walkDown(parent, depth + 1);
      }
    }
  }

  // Traverse down (parent → child → grandchild → ...)
  function walkDown(node: string, depth: number): void {
    for (const child of children.get(node) || []) {
      if (!distances.has(child)) {
        distances.set(child, depth);
        addEdge(node, child);
        walkDown(child, depth + 1);
      }
    }
  }

  walkUp(entityName, 1);
  walkDown(entityName, 1);

  const svg = deps.getSvg();

  // Mark SVG as having a selection active (dims everything by default)
  svg.classList.add('has-selection');

  // Apply depth classes to entities
  svg.querySelectorAll('.entity').forEach((el) => {
    const name = el.getAttribute('data-entity') || '';
    el.classList.remove('hl-selected', 'hl-depth-1', 'hl-depth-2', 'hl-depth-far', 'hl-unrelated');
    const dist = distances.get(name);
    if (dist === 0) {
      el.classList.add('hl-selected');
    } else if (dist === 1) {
      el.classList.add('hl-depth-1');
    } else if (dist === 2) {
      el.classList.add('hl-depth-2');
    } else if (dist !== undefined) {
      el.classList.add('hl-depth-far');
    } else {
      el.classList.add('hl-unrelated');
    }
  });

  // Highlight connectors on the BFS tree path
  svg.querySelectorAll('.connector').forEach((el) => {
    const from = el.getAttribute('data-from') || '';
    const to = el.getAttribute('data-to') || '';
    el.classList.remove('hl-connector', 'hl-unrelated');
    if (treeEdges.has(from + '\0' + to)) {
      el.classList.add('hl-connector');
    } else {
      el.classList.add('hl-unrelated');
    }
  });
}

export function clearHighlight(
  state: HighlightState,
  deps: HighlightDeps,
): void {
  state.selectedEntity = null;
  const svg = deps.getSvg();
  svg.classList.remove('has-selection');
  svg.querySelectorAll('.hl-selected, .hl-depth-1, .hl-depth-2, .hl-depth-far, .hl-unrelated, .hl-connector').forEach((el) => {
    el.classList.remove('hl-selected', 'hl-depth-1', 'hl-depth-2', 'hl-depth-far', 'hl-unrelated', 'hl-connector');
  });
}
