import type { ERDiagramJSON, Entity } from '../parser/types.js';

export type LayoutAlgorithm = 'sugiyama' | 'force' | 'community';

export interface EntityPositions {
  [entityName: string]: { x: number; y: number };
}

// Layout constants
const GRID_SPACING_X = 320;
const GRID_SPACING_Y = 300;
const LAYER_SPACING_X = 500;
const ENTITY_SPACING_Y = 80;
const OFFSET_X = 100;
const OFFSET_Y = 100;
const BARYCENTER_ITERATIONS = 4;
const COMPONENT_GAP_Y = 120;
const APP_GROUP_GAP_Y = 200;
const MIN_COMMUNITY_SIZE = 8;

// Force layout constants
const FORCE_ITERATIONS = 300;
const REPULSION = 80000;
const ATTRACTION = 0.005;
const DAMPING = 0.9;
const MIN_DISTANCE = 50;

/** Estimate the rendered height of an entity box */
function estimateEntityHeight(entity: Entity): number {
  const headerHeight = entity.label !== entity.name ? 44 : 32;
  return headerHeight + Math.max(entity.attributes.length * 24, 24);
}

/**
 * Get effective height for an entity, using provided sizes or estimation.
 */
function getEntityHeight(
  entity: Entity,
  entitySizes?: Record<string, { width: number; height: number }>,
): number {
  if (entitySizes && entitySizes[entity.name]) {
    return entitySizes[entity.name].height;
  }
  return estimateEntityHeight(entity);
}

/**
 * Detect app prefix from entity name.
 * Works with Django-style naming (appname_modelname) and similar conventions.
 */
function detectAppPrefix(name: string): string {
  const idx = name.indexOf('_');
  return idx > 0 ? name.substring(0, idx).toLowerCase() : '';
}

/**
 * Compute auto-layout positions for all entities using the specified algorithm.
 *
 * Pure function: takes diagram data and optional entity sizes, returns positions.
 * No DOM, SVG, or browser API dependencies.
 */
export function computeAutoLayout(
  diagram: ERDiagramJSON,
  algorithm: LayoutAlgorithm = 'sugiyama',
  entitySizes?: Record<string, { width: number; height: number }>,
): EntityPositions {
  switch (algorithm) {
    case 'force':
      return computeForceLayout(diagram, entitySizes);
    case 'community':
      return computeCommunityLayout(diagram, entitySizes);
    case 'sugiyama':
    default:
      return computeSugiyamaLayout(diagram, entitySizes);
  }
}

/**
 * Sugiyama-based hierarchical layout (the original autoLayoutAll algorithm).
 */
function computeSugiyamaLayout(
  diagram: ERDiagramJSON,
  entitySizes?: Record<string, { width: number; height: number }>,
): EntityPositions {
  const entityNames = Object.keys(diagram.entities);
  if (entityNames.length === 0) return {};

  // --- Phase 1: Build directed graph ---
  const children = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  const neighbors = new Map<string, Set<string>>();

  for (const name of entityNames) {
    children.set(name, new Set());
    parents.set(name, new Set());
    neighbors.set(name, new Set());
  }

  for (const rel of diagram.relationships) {
    const a = rel.entityA;
    const b = rel.entityB;
    if (!children.has(a) || !children.has(b)) continue;

    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);

    const aIsOne = rel.cardinalityA.max === 'one';
    const bIsOne = rel.cardinalityB.max === 'one';
    const aIsMany = rel.cardinalityA.max === 'many';
    const bIsMany = rel.cardinalityB.max === 'many';

    if (aIsOne && bIsMany) {
      children.get(a)!.add(b);
      parents.get(b)!.add(a);
    } else if (aIsMany && bIsOne) {
      children.get(b)!.add(a);
      parents.get(a)!.add(b);
    }
  }

  // --- Phase 1b: Cycle detection & removal (DFS) ---
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of entityNames) color.set(name, WHITE);

  function dfsRemoveCycles(u: string): void {
    color.set(u, GRAY);
    for (const v of children.get(u)!) {
      if (color.get(v) === GRAY) {
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
  const appPrefixMap = new Map<string, string[]>();
  for (const name of entityNames) {
    const prefix = detectAppPrefix(name);
    if (!appPrefixMap.has(prefix)) appPrefixMap.set(prefix, []);
    appPrefixMap.get(prefix)!.push(name);
  }

  const meaningfulAppGroups = [...appPrefixMap.entries()].filter(
    ([prefix, entities]) => prefix !== '' && entities.length >= 2,
  );
  const useAppGrouping = meaningfulAppGroups.length >= 2;

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

  // --- Helper: find connected components ---
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
  function detectCommunities(component: string[]): string[][] {
    if (component.length < MIN_COMMUNITY_SIZE) return [component];

    const memberSet = new Set(component);

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
    m /= 2;
    if (m === 0) return [component];

    const comm = new Map<string, number>();
    let nextId = 0;
    for (const name of component) {
      comm.set(name, nextId++);
    }

    const sigmaTot = new Map<number, number>();
    for (const name of component) {
      sigmaTot.set(comm.get(name)!, deg.get(name)!);
    }

    let improved = true;
    let iterations = 0;
    while (improved && iterations < 20) {
      improved = false;
      iterations++;

      for (const node of component) {
        const currentComm = comm.get(node)!;
        const ki = deg.get(node)!;

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

  // --- Helper: layout a single connected component ---
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
        totalHeight += getEntityHeight(diagram.entities[layer[i]], entitySizes);
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
        y += getEntityHeight(diagram.entities[name], entitySizes) + ENTITY_SPACING_Y;
      }
    }

    return startY + maxHeight;
  }

  // --- Phase 4: Layout each group ---
  const positions: EntityPositions = {};
  let globalOffsetY = OFFSET_Y;

  for (const group of topLevelGroups) {
    const { components, isolated } = findComponents(group);

    for (const component of components) {
      const bottomY = layoutComponent(component, globalOffsetY);
      globalOffsetY = bottomY + COMPONENT_GAP_Y;
    }

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

    if (useGroupGap) {
      globalOffsetY += APP_GROUP_GAP_Y - COMPONENT_GAP_Y;
    }
  }

  return positions;
}

/**
 * Force-directed layout.
 * Simulates physical forces: nodes repel each other, edges attract connected nodes.
 */
function computeForceLayout(
  diagram: ERDiagramJSON,
  entitySizes?: Record<string, { width: number; height: number }>,
): EntityPositions {
  const entityNames = Object.keys(diagram.entities);
  if (entityNames.length === 0) return {};

  // Build neighbor list
  const neighbors = new Map<string, Set<string>>();
  for (const name of entityNames) {
    neighbors.set(name, new Set());
  }
  for (const rel of diagram.relationships) {
    if (neighbors.has(rel.entityA) && neighbors.has(rel.entityB)) {
      neighbors.get(rel.entityA)!.add(rel.entityB);
      neighbors.get(rel.entityB)!.add(rel.entityA);
    }
  }

  // Initialize positions in a circle
  const positions: Record<string, { x: number; y: number }> = {};
  const velocities: Record<string, { vx: number; vy: number }> = {};
  const radius = Math.max(200, entityNames.length * 40);

  for (let i = 0; i < entityNames.length; i++) {
    const angle = (2 * Math.PI * i) / entityNames.length;
    positions[entityNames[i]] = {
      x: radius * Math.cos(angle) + radius,
      y: radius * Math.sin(angle) + radius,
    };
    velocities[entityNames[i]] = { vx: 0, vy: 0 };
  }

  // Simulation
  for (let iter = 0; iter < FORCE_ITERATIONS; iter++) {
    const temperature = 1 - iter / FORCE_ITERATIONS;

    // Repulsive forces between all pairs
    for (let i = 0; i < entityNames.length; i++) {
      for (let j = i + 1; j < entityNames.length; j++) {
        const a = entityNames[i];
        const b = entityNames[j];
        const dx = positions[b].x - positions[a].x;
        const dy = positions[b].y - positions[a].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DISTANCE);
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force * temperature;
        const fy = (dy / dist) * force * temperature;
        velocities[a].vx -= fx;
        velocities[a].vy -= fy;
        velocities[b].vx += fx;
        velocities[b].vy += fy;
      }
    }

    // Attractive forces along edges
    for (const rel of diagram.relationships) {
      const a = rel.entityA;
      const b = rel.entityB;
      if (!positions[a] || !positions[b]) continue;
      const dx = positions[b].x - positions[a].x;
      const dy = positions[b].y - positions[a].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;
      const force = dist * ATTRACTION * temperature;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      velocities[a].vx += fx;
      velocities[a].vy += fy;
      velocities[b].vx -= fx;
      velocities[b].vy -= fy;
    }

    // Update positions
    for (const name of entityNames) {
      velocities[name].vx *= DAMPING;
      velocities[name].vy *= DAMPING;
      positions[name].x += velocities[name].vx;
      positions[name].y += velocities[name].vy;
    }
  }

  // Normalize: shift so min position is at OFFSET
  let minX = Infinity, minY = Infinity;
  for (const name of entityNames) {
    if (positions[name].x < minX) minX = positions[name].x;
    if (positions[name].y < minY) minY = positions[name].y;
  }
  const result: EntityPositions = {};
  for (const name of entityNames) {
    result[name] = {
      x: Math.round(positions[name].x - minX + OFFSET_X),
      y: Math.round(positions[name].y - minY + OFFSET_Y),
    };
  }
  return result;
}

/**
 * Community-based layout.
 * First detects communities, then lays out each community as a cluster.
 * Uses Sugiyama within each community, and arranges communities in a grid.
 */
function computeCommunityLayout(
  diagram: ERDiagramJSON,
  entitySizes?: Record<string, { width: number; height: number }>,
): EntityPositions {
  // Delegate to Sugiyama which already does community detection + grouping
  // The 'community' algorithm forces community grouping regardless of size threshold
  const entityNames = Object.keys(diagram.entities);
  if (entityNames.length === 0) return {};

  // Build neighbor list for community detection
  const neighbors = new Map<string, Set<string>>();
  for (const name of entityNames) {
    neighbors.set(name, new Set());
  }
  for (const rel of diagram.relationships) {
    if (neighbors.has(rel.entityA) && neighbors.has(rel.entityB)) {
      neighbors.get(rel.entityA)!.add(rel.entityB);
      neighbors.get(rel.entityB)!.add(rel.entityA);
    }
  }

  // Find connected components
  const vis = new Set<string>();
  const components: string[][] = [];
  const isolated: string[] = [];

  for (const name of entityNames) {
    if (vis.has(name)) continue;
    const hasNeighbor = neighbors.get(name)!.size > 0;
    if (!hasNeighbor) {
      isolated.push(name);
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
        if (!vis.has(nb)) {
          vis.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }

  // For each component, run Sugiyama sub-layout
  // Then arrange the components in vertical blocks
  // This reuses the Sugiyama algorithm via computeSugiyamaLayout on sub-diagrams
  const positions: EntityPositions = {};
  let globalOffsetY = OFFSET_Y;

  for (const comp of components) {
    const compSet = new Set(comp);
    const subDiagram: ERDiagramJSON = {
      entities: {},
      relationships: diagram.relationships.filter(
        r => compSet.has(r.entityA) && compSet.has(r.entityB),
      ),
    };
    for (const name of comp) {
      subDiagram.entities[name] = diagram.entities[name];
    }

    const subPositions = computeSugiyamaLayout(subDiagram, entitySizes);

    // Find max Y in sub-positions to know the height
    let maxY = 0;
    for (const name of comp) {
      if (subPositions[name]) {
        const h = getEntityHeight(diagram.entities[name], entitySizes);
        const bottom = subPositions[name].y + h;
        if (bottom > maxY) maxY = bottom;
        // Shift Y by current offset
        positions[name] = {
          x: subPositions[name].x,
          y: subPositions[name].y - OFFSET_Y + globalOffsetY,
        };
      }
    }
    globalOffsetY += (maxY - OFFSET_Y) + COMPONENT_GAP_Y;
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
  }

  return positions;
}
