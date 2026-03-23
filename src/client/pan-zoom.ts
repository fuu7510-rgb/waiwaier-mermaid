export interface PanZoomState {
  panX: number;
  panY: number;
  zoom: number;
  isPanning: boolean;
  panStartX: number;
  panStartY: number;
  panStartPanX: number;
  panStartPanY: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

export function createPanZoomState(): PanZoomState {
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    panStartPanX: 0,
    panStartPanY: 0,
  };
}

export interface PanZoomDeps {
  svg: SVGSVGElement;
  getSelectedEntity: () => string | null;
  onTransformChange: () => void;
  onCanvasSave: () => void;
  onCanvasSaveAndSchedule: () => void;
  onClearHighlight: () => void;
  onEntityDblClick: (entityName: string) => void;
}

export function setupPanZoom(state: PanZoomState, deps: PanZoomDeps): void {
  const { svg } = deps;

  // Wheel event: Ctrl+wheel = zoom, plain wheel = pan
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();

    if (e.ctrlKey) {
      // Ctrl+wheel (mouse scroll wheel or touchpad pinch) → Zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * delta));

      // Zoom towards cursor position
      const rect = svg.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      state.panX = cursorX - (cursorX - state.panX) * (newZoom / state.zoom);
      state.panY = cursorY - (cursorY - state.panY) * (newZoom / state.zoom);
      state.zoom = newZoom;
    } else {
      // Plain wheel (mouse scroll or touchpad two-finger scroll) → Pan
      state.panX -= e.deltaX;
      state.panY -= e.deltaY;
    }

    deps.onTransformChange();
    deps.onCanvasSave();
  }, { passive: false });

  // Pan with middle mouse button or right-click drag
  svg.addEventListener('mousedown', (e) => {
    // Middle button or Ctrl+Left button for panning
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault();
      state.isPanning = true;
      state.panStartX = e.clientX;
      state.panStartY = e.clientY;
      state.panStartPanX = state.panX;
      state.panStartPanY = state.panY;
      svg.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.isPanning) return;
    state.panX = state.panStartPanX + (e.clientX - state.panStartX);
    state.panY = state.panStartPanY + (e.clientY - state.panStartY);
    deps.onTransformChange();
  });

  window.addEventListener('mouseup', (_e) => {
    if (state.isPanning) {
      state.isPanning = false;
      svg.style.cursor = '';
      deps.onCanvasSaveAndSchedule();
    }
  });

  // Click on empty space to clear highlight
  svg.addEventListener('click', (e) => {
    const target = e.target as SVGElement;
    if (!target.closest('.entity') && deps.getSelectedEntity()) {
      deps.onClearHighlight();
    }
  });

  // ダブルクリックでラベル編集
  svg.addEventListener('dblclick', (e) => {
    const target = e.target as SVGElement;

    // エンティティのヘッダー → テーブルラベル編集
    const entityG = target.closest('.entity') as SVGGElement | null;
    if (entityG) {
      if (!target.classList.contains('entity-header') &&
          !target.classList.contains('entity-name') &&
          !target.classList.contains('entity-label')) return;
      const entityName = entityG.getAttribute('data-entity') || '';
      if (!entityName) return;
      e.preventDefault();
      deps.onEntityDblClick(entityName);
      return;
    }

  });

  // Prevent context menu on SVG
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
}
