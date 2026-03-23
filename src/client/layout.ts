import type { LayoutData, ERDiagramJSON } from '../parser/types.js';
import { computeAutoLayout } from '../shared/auto-layout.js';

const GRID_COLS = 4;
const GRID_SPACING_X = 320;
const GRID_SPACING_Y = 300;
const GRID_OFFSET_X = 60;
const GRID_OFFSET_Y = 60;

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

/** Full auto-layout for all entities (delegates to shared module) */
export function autoLayoutAll(diagram: ERDiagramJSON): Record<string, { x: number; y: number }> {
  return computeAutoLayout(diagram, 'sugiyama');
}
