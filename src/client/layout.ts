import type { LayoutData, ERDiagramJSON, Entity } from '../parser/types.js';

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
const APP_GROUP_GAP_Y = 200;
const MIN_COMMUNITY_SIZE = 8;

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
function estimateEntityHeight(entity: Entity): number {
  const headerHeight = entity.label !== entity.name ? 44 : 32;
  return headerHeight + Math.max(entity.attributes.length * 24, 24);
}

/**
 * Detect app prefix from entity name.
 * Works with Django-style naming (appname_modelname) and similar conventions.
 * Returns lowercase prefix, or '' if no underscore found.
 */
function detectAppPrefix(name: string): string {
  const idx = name.indexOf('_');
  return idx > 0 ? name.substring(0, idx).toLowerCase() : '';
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

  // --- Phase 2: Detect grouping strategy ---
  // Check for Django-style app prefixes (e.g., auth_user, orders_order)
  const appPrefixMap = new Map<string, string[]>();
  for (const name of entityNames) {
    const prefix = detectAppPrefix(name);
    if (!appPrefixMap.has(prefix)) appPrefixMap.set(prefix, []);
    appPrefixMap.get(prefix)!.push(name);
  }

  // App grouping is useful if at least 2 prefixed groups have 2+ entities
  const meaningfulAppGroups = [...appPrefixMap.entries()].filter(
    ([prefix, entities]) => prefix !== '' && entities.length >= 2,
  );
  const useAppGrouping = meaningfulAppGroups.length >= 2;

  // Build ordered list of entity groups
  const topLevelGroups: string[][] = [];
  let useGroupGap = false;

  if (useAppGrouping) {
    useGroupGap = true;
    const sorted = [...appPrefixMap.entries()]
      .sort((a, b) => b[1].length - a[1].length);
    for (const [, entities] of sorted) {
      topLevelGroups.push(entities);
    }
  } else {
    // Find connected components, then apply community detection to large ones
    const { components, isolated } = findComponents(entityNames);

    for (const comp of components) {
      const communities = detectCommunities(comp);
      if (communities.length > 1) useGroupGap = true;
      topLevelGroups.push(...communities);
    }

    if (isolated.length > 0) {
      topLevelGroups.push(isolated);
    }
  }

  // --- Helper: find connected components within a subset of entities ---
  function findComponents(entitySubset: string[]): { components: string[][]; isolated: string[] } {
    const memberSet = new Set(entitySubset);
    const vis = new Set<string>();
    const comps: string[][] = [];
    const iso: string[] = [];

    for (const name of entitySubset) {
      if (vis.has(name)) continue;

      let hasNeighborInSet = false;
      for (const nb of neighbors.get(name)!) {
        if (memberSet.has(nb)) { hasNeighborInSet = true; break; }
      }

      if (!hasNeighborInSet) {
        iso.push(name);
        vis.add(name);
        continue;
      }

      const comp: string[] = [];
      const queue = [name];
      vis.add(name);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        comp.push(curr);
        for (const nb of neighbors.get(curr)!) {
          if (memberSet.has(nb) && !vis.has(nb)) {
            vis.add(nb);
            queue.push(nb);
          }
        }
      }
      comps.push(comp);
    }

    comps.sort((a, b) => b.length - a.length);
    return { components: comps, isolated: iso };
  }

  // --- Helper: community detection (Louvain phase 1) ---
  // Splits a large connected component into densely-connected sub-groups
  // by greedily optimizing modularity.
  function detectCommunities(component: string[]): string[][] {
    if (component.length < MIN_COMMUNITY_SIZE) return [component];

    const memberSet = new Set(component);

    // Count edges and degrees within the component
    let m = 0;
    const deg = new Map<string, number>();
    for (const name of component) {
      let d = 0;
      for (const nb of neighbors.get(name)!) {
        if (memberSet.has(nb)) d++;
      }
      deg.set(name, d);
      m += d;
    }
    m /= 2; // each edge counted twice
    if (m === 0) return [component];

    // Initialize: each node in its own community
    const comm = new Map<string, number>();
    let nextId = 0;
    for (const name of component) {
      comm.set(name, nextId++);
    }

    // sigma_tot[c] = sum of degrees of nodes in community c
    const sigmaTot = new Map<number, number>();
    for (const name of component) {
      sigmaTot.set(comm.get(name)!, deg.get(name)!);
    }

    // Greedy modularity optimization
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 20) {
      improved = false;
      iterations++;

      for (const node of component) {
        const currentComm = comm.get(node)!;
        const ki = deg.get(node)!;

        // Count edges from this node to each neighboring community
        const edgesToComm = new Map<number, number>();
        for (const nb of neighbors.get(node)!) {
          if (!memberSet.has(nb)) continue;
          const nbComm = comm.get(nb)!;
          edgesToComm.set(nbComm, (edgesToComm.get(nbComm) || 0) + 1);
        }

        const ki_in_current = edgesToComm.get(currentComm) || 0;
        const sigma_tot_current = sigmaTot.get(currentComm)! - ki;

        let bestComm = currentComm;
        let bestDeltaQ = 0;

        for (const [targetComm, ki_in_target] of edgesToComm) {
          if (targetComm === currentComm) continue;

          const sigma_tot_target = sigmaTot.get(targetComm)!;

          // Modularity gain:
          // ΔQ = (k_i_in_target - k_i_in_current) / m
          //    - k_i * (Σ_tot_target - Σ_tot_current) / (2m²)
          const deltaQ =
            (ki_in_target - ki_in_current) / m -
            (ki * (sigma_tot_target - sigma_tot_current)) / (2 * m * m);

          if (deltaQ > bestDeltaQ) {
            bestDeltaQ = deltaQ;
            bestComm = targetComm;
          }
        }

        if (bestComm !== currentComm) {
          sigmaTot.set(currentComm, sigmaTot.get(currentComm)! - ki);
          sigmaTot.set(bestComm, sigmaTot.get(bestComm)! + ki);
          comm.set(node, bestComm);
          if (sigmaTot.get(currentComm) === 0) sigmaTot.delete(currentComm);
          improved = true;
        }
      }
    }

    // Collect communities
    const communityMap = new Map<number, string[]>();
    for (const name of component) {
      const c = comm.get(name)!;
      if (!communityMap.has(c)) communityMap.set(c, []);
      communityMap.get(c)!.push(name);
    }

    const result = [...communityMap.values()];
    if (result.length <= 1) return [component];

    result.sort((a, b) => b.length - a.length);
    return result;
  }

  // --- Helper: layer assignment (Kahn's algorithm) ---
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

    for (const name of component) {
      if (!layerOf.has(name)) layerOf.set(name, 0);
    }

    return layerOf;
  }

  // --- Helper: barycenter ordering ---
  function orderLayers(layerOf: LayerMap, component: string[]): string[][] {
    let maxLayer = 0;
    for (const l of layerOf.values()) {
      if (l > maxLayer) maxLayer = l;
    }

    const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const name of component) {
      layers[layerOf.get(name)!].push(name);
    }

    for (let iter = 0; iter < BARYCENTER_ITERATIONS; iter++) {
      if (iter % 2 === 0) {
        for (let l = 1; l <= maxLayer; l++) {
          sortByBarycenter(layers[l], layers[l - 1]);
        }
      } else {
        for (let l = maxLayer - 1; l >= 0; l--) {
          sortByBarycenter(layers[l], layers[l + 1]);
        }
      }
    }

    return layers;
  }

  function sortByBarycenter(layer: string[], adjacentLayer: string[]): void {
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

  // --- Helper: layout a single connected component, returns bottom Y ---
  function layoutComponent(
    component: string[],
    startY: number,
  ): number {
    const layerOf = assignLayers(component);
    const layers = orderLayers(layerOf, component);

    const layerHeights: number[] = [];
    for (const layer of layers) {
      let totalHeight = 0;
      for (let i = 0; i < layer.length; i++) {
        totalHeight += estimateEntityHeight(diagram.entities[layer[i]]);
        if (i < layer.length - 1) totalHeight += ENTITY_SPACING_Y;
      }
      layerHeights.push(totalHeight);
    }

    const maxHeight = Math.max(...layerHeights);

    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      const x = OFFSET_X + l * LAYER_SPACING_X;
      const layerHeight = layerHeights[l];
      let y = startY + (maxHeight - layerHeight) / 2;

      for (const name of layer) {
        positions[name] = { x, y };
        y += estimateEntityHeight(diagram.entities[name]) + ENTITY_SPACING_Y;
      }
    }

    return startY + maxHeight;
  }

  // --- Phase 4: Layout each group ---
  const positions: Record<string, { x: number; y: number }> = {};
  let globalOffsetY = OFFSET_Y;

  for (const group of topLevelGroups) {
    const { components, isolated } = findComponents(group);

    for (const component of components) {
      const bottomY = layoutComponent(component, globalOffsetY);
      globalOffsetY = bottomY + COMPONENT_GAP_Y;
    }

    // Place isolated entities in a grid
    if (isolated.length > 0) {
      const isoCols = 4;
      for (let i = 0; i < isolated.length; i++) {
        const col = i % isoCols;
        const row = Math.floor(i / isoCols);
        positions[isolated[i]] = {
          x: OFFSET_X + col * LAYER_SPACING_X,
          y: globalOffsetY + row * GRID_SPACING_Y,
        };
      }
      const isoRows = Math.ceil(isolated.length / isoCols);
      globalOffsetY += isoRows * GRID_SPACING_Y;
    }

    // Extra gap between visual groups (app-based or community-based)
    if (useGroupGap) {
      globalOffsetY += APP_GROUP_GAP_Y - COMPONENT_GAP_Y;
    }
  }

  return positions;
}
