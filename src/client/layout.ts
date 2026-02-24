import type { LayoutData, ERDiagramJSON } from '../parser/types.js';

const GRID_COLS = 4;
const GRID_SPACING_X = 320;
const GRID_SPACING_Y = 300;
const GRID_OFFSET_X = 60;
const GRID_OFFSET_Y = 60;

// Hierarchical layout constants
const LAYER_SPACING_X = 500;
const ENTITY_SPACING_Y = 80;
const OFFSET_X = 100;
const OFFSET_Y = 100;
const BARYCENTER_ITERATIONS = 4;
const COMPONENT_GAP_Y = 120;

/** Auto-layout entities that don't have positions yet */
export function autoLayoutNewEntities(
  diagram: ERDiagramJSON,
  layout: LayoutData,
): LayoutData {
  const entityNames = Object.keys(diagram.entities);
  const existingNames = new Set(Object.keys(layout.entities));

  let nextIndex = existingNames.size;

  for (const name of entityNames) {
    if (!existingNames.has(name)) {
      const col = nextIndex % GRID_COLS;
      const row = Math.floor(nextIndex / GRID_COLS);
      layout.entities[name] = {
        x: GRID_OFFSET_X + col * GRID_SPACING_X,
        y: GRID_OFFSET_Y + row * GRID_SPACING_Y,
      };
      nextIndex++;
    }
  }

  // Remove layout entries for entities that no longer exist
  for (const name of Object.keys(layout.entities)) {
    if (!diagram.entities[name]) {
      delete layout.entities[name];
    }
  }

  return layout;
}

/** Estimate the rendered height of an entity box */
function estimateEntityHeight(entity: { label: string; attributes: { name: string }[] }): number {
  const headerHeight = entity.label !== entity.name ? 44 : 32;
  return headerHeight + Math.max(entity.attributes.length * 24, 24);
}

/** Full auto-layout for all entities (Sugiyama-based hierarchical layout) */
export function autoLayoutAll(diagram: ERDiagramJSON): Record<string, { x: number; y: number }> {
  const entityNames = Object.keys(diagram.entities);
  if (entityNames.length === 0) return {};

  // --- Phase 1: Build directed graph ---
  // parentOf edges: parent -> child (1-side -> N-side)
  const children = new Map<string, Set<string>>(); // parent -> children
  const parents = new Map<string, Set<string>>();   // child -> parents
  const neighbors = new Map<string, Set<string>>(); // undirected for barycenter

  for (const name of entityNames) {
    children.set(name, new Set());
    parents.set(name, new Set());
    neighbors.set(name, new Set());
  }

  for (const rel of diagram.relationships) {
    const a = rel.entityA;
    const b = rel.entityB;
    if (!children.has(a) || !children.has(b)) continue;

    // Add undirected neighbor edges
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);

    const aIsOne = rel.cardinalityA.max === 'one';
    const bIsOne = rel.cardinalityB.max === 'one';
    const aIsMany = rel.cardinalityA.max === 'many';
    const bIsMany = rel.cardinalityB.max === 'many';

    if (aIsOne && bIsMany) {
      // A(1) -> B(N): A is parent, B is child
      children.get(a)!.add(b);
      parents.get(b)!.add(a);
    } else if (aIsMany && bIsOne) {
      // A(N) -> B(1): B is parent, A is child
      children.get(b)!.add(a);
      parents.get(a)!.add(b);
    }
    // 1:1 and N:M: no directed edge (handled by undirected neighbors only)
  }

  // --- Phase 1b: Cycle detection & removal (DFS) ---
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of entityNames) color.set(name, WHITE);

  function dfsRemoveCycles(u: string): void {
    color.set(u, GRAY);
    for (const v of children.get(u)!) {
      if (color.get(v) === GRAY) {
        // Back edge found — remove it to break cycle
        children.get(u)!.delete(v);
        parents.get(v)!.delete(u);
      } else if (color.get(v) === WHITE) {
        dfsRemoveCycles(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const name of entityNames) {
    if (color.get(name) === WHITE) dfsRemoveCycles(name);
  }

  // --- Phase 2a: Find connected components (BFS on undirected graph) ---
  const visited = new Set<string>();
  const components: string[][] = [];
  const isolated: string[] = [];

  for (const name of entityNames) {
    if (visited.has(name)) continue;

    // Check if this entity has any relationships
    if (neighbors.get(name)!.size === 0) {
      isolated.push(name);
      visited.add(name);
      continue;
    }

    const component: string[] = [];
    const queue = [name];
    visited.add(name);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const nb of neighbors.get(curr)!) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(component);
  }

  // Sort components: larger ones first
  components.sort((a, b) => b.length - a.length);

  // --- Phase 2b: Layer assignment per component (Kahn's algorithm) ---
  type LayerMap = Map<string, number>;

  function assignLayers(component: string[]): LayerMap {
    const compSet = new Set(component);
    const layerOf: LayerMap = new Map();
    const inDegree = new Map<string, number>();

    for (const name of component) {
      let deg = 0;
      for (const p of parents.get(name)!) {
        if (compSet.has(p)) deg++;
      }
      inDegree.set(name, deg);
    }

    // Start with roots (in-degree 0)
    const queue: string[] = [];
    for (const name of component) {
      if (inDegree.get(name) === 0) {
        queue.push(name);
        layerOf.set(name, 0);
      }
    }

    while (queue.length > 0) {
      const u = queue.shift()!;
      const uLayer = layerOf.get(u)!;
      for (const v of children.get(u)!) {
        if (!compSet.has(v)) continue;
        const prevLayer = layerOf.get(v);
        const newLayer = uLayer + 1;
        if (prevLayer === undefined || newLayer > prevLayer) {
          layerOf.set(v, newLayer);
        }
        inDegree.set(v, inDegree.get(v)! - 1);
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      }
    }

    // Any unassigned nodes (only connected via 1:1 or M:N) → layer 0
    for (const name of component) {
      if (!layerOf.has(name)) layerOf.set(name, 0);
    }

    return layerOf;
  }

  // --- Phase 3: Barycenter ordering within layers ---
  function orderLayers(
    layerOf: LayerMap,
    component: string[],
  ): string[][] {
    // Group entities by layer
    let maxLayer = 0;
    for (const l of layerOf.values()) {
      if (l > maxLayer) maxLayer = l;
    }

    const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const name of component) {
      layers[layerOf.get(name)!].push(name);
    }

    // Barycenter heuristic sweeps
    for (let iter = 0; iter < BARYCENTER_ITERATIONS; iter++) {
      if (iter % 2 === 0) {
        // Left to right sweep
        for (let l = 1; l <= maxLayer; l++) {
          sortByBarycenter(layers[l], layers[l - 1], layerOf);
        }
      } else {
        // Right to left sweep
        for (let l = maxLayer - 1; l >= 0; l--) {
          sortByBarycenter(layers[l], layers[l + 1], layerOf);
        }
      }
    }

    return layers;
  }

  function sortByBarycenter(
    layer: string[],
    adjacentLayer: string[],
    _layerOf: LayerMap,
  ): void {
    // Build position map for adjacent layer
    const posMap = new Map<string, number>();
    adjacentLayer.forEach((name, i) => posMap.set(name, i));

    const barycenters = new Map<string, number>();
    for (const name of layer) {
      const adjPositions: number[] = [];
      for (const nb of neighbors.get(name)!) {
        const pos = posMap.get(nb);
        if (pos !== undefined) adjPositions.push(pos);
      }
      if (adjPositions.length > 0) {
        const sum = adjPositions.reduce((a, b) => a + b, 0);
        barycenters.set(name, sum / adjPositions.length);
      } else {
        barycenters.set(name, Infinity);
      }
    }

    layer.sort((a, b) => barycenters.get(a)! - barycenters.get(b)!);
  }

  // --- Phase 4: Coordinate assignment ---
  const positions: Record<string, { x: number; y: number }> = {};
  let globalOffsetY = OFFSET_Y;

  for (const component of components) {
    const layerOf = assignLayers(component);
    const layers = orderLayers(layerOf, component);

    // Calculate heights per layer
    const layerHeights: number[] = [];
    for (const layer of layers) {
      let totalHeight = 0;
      for (let i = 0; i < layer.length; i++) {
        const entity = diagram.entities[layer[i]];
        totalHeight += estimateEntityHeight(entity);
        if (i < layer.length - 1) totalHeight += ENTITY_SPACING_Y;
      }
      layerHeights.push(totalHeight);
    }

    // Find the tallest layer for vertical centering
    const maxHeight = Math.max(...layerHeights);

    // Assign coordinates
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      const x = OFFSET_X + l * LAYER_SPACING_X;
      const layerHeight = layerHeights[l];
      let y = globalOffsetY + (maxHeight - layerHeight) / 2;

      for (const name of layer) {
        positions[name] = { x, y };
        y += estimateEntityHeight(diagram.entities[name]) + ENTITY_SPACING_Y;
      }
    }

    globalOffsetY += maxHeight + COMPONENT_GAP_Y;
  }

  // Place isolated entities in a grid below everything
  if (isolated.length > 0) {
    const isoCols = 4;
    for (let i = 0; i < isolated.length; i++) {
      const col = i % isoCols;
      const row = Math.floor(i / isoCols);
      positions[isolated[i]] = {
        x: OFFSET_X + col * LAYER_SPACING_X,
        y: globalOffsetY + row * (GRID_SPACING_Y),
      };
    }
  }

  return positions;
}
