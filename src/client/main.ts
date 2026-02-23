import { fetchDiagram, fetchLayout, saveLayout } from './api.js';
import { WebSocketClient } from './websocket.js';
import { Renderer } from './renderer.js';
import { DragHandler } from './drag.js';
import { autoLayoutNewEntities, autoLayoutAll } from './layout.js';
import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

let diagram: ERDiagramJSON | null = null;
let layout: LayoutData | null = null;
let renderer: Renderer;
let dragHandler: DragHandler;
let saveTimer: number | null = null;

// Pan & Zoom state
let panX = 0;
let panY = 0;
let zoom = 1;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

function getSvg(): SVGSVGElement {
  return document.getElementById('er-svg') as unknown as SVGSVGElement;
}

function getViewportGroup(): SVGGElement {
  return document.getElementById('viewport')! as unknown as SVGGElement;
}

function updateViewportTransform(): void {
  const vp = getViewportGroup();
  vp.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoom})`);
  dragHandler.setTransform(panX, panY, zoom);
}

async function loadAndRender(): Promise<void> {
  try {
    diagram = await fetchDiagram();
    layout = await fetchLayout();

    // Auto-layout new entities
    layout = autoLayoutNewEntities(diagram, layout);

    renderer.render(diagram, layout.entities, layout.labels);
    updateViewportTransform();

    // Clear error
    const errorEl = document.getElementById('error-bar');
    if (errorEl) errorEl.style.display = 'none';
  } catch (err: any) {
    showError(err.message || 'Failed to load diagram');
  }
}

function showError(msg: string): void {
  const errorEl = document.getElementById('error-bar');
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
}

function scheduleSaveLayout(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    saveTimer = null;
    if (layout) {
      try {
        await saveLayout(layout);
      } catch (err: any) {
        console.error('Failed to save layout:', err);
      }
    }
  }, 500);
}

function handleDragEnd(entityName: string, x: number, y: number): void {
  if (!layout) return;
  layout.entities[entityName] = { x, y };
  scheduleSaveLayout();
}

let selectedEntity: string | null = null;

function handleEntityClick(target: SVGElement, entityName: string): void {
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
        showToast(`Copied: ${copyText}`);
      });
    }
  }

  // Highlight toggle
  if (selectedEntity === entityName) {
    clearHighlight();
  } else {
    highlightRelated(entityName);
  }
}

/**
 * Build directed parent/child maps from relationships.
 * In ER cardinality, the "one" side (entityA with ||) is the parent,
 * the "many" side (entityB with o{ / |{) is the child.
 */
function buildDirectedGraph(): {
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

function highlightRelated(entityName: string): void {
  selectedEntity = entityName;
  const { parents, children } = buildDirectedGraph();

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

  const svg = getSvg();

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

function clearHighlight(): void {
  selectedEntity = null;
  const svg = getSvg();
  svg.classList.remove('has-selection');
  svg.querySelectorAll('.hl-selected, .hl-depth-1, .hl-depth-2, .hl-depth-far, .hl-unrelated, .hl-connector').forEach((el) => {
    el.classList.remove('hl-selected', 'hl-depth-1', 'hl-depth-2', 'hl-depth-far', 'hl-unrelated', 'hl-connector');
  });
}

let toastTimer: number | null = null;

function showToast(msg: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast!.classList.remove('visible');
    toastTimer = null;
  }, 1500);
}

function handleAutoLayout(): void {
  if (!diagram || !layout) return;
  layout.entities = autoLayoutAll(diagram);
  renderer.render(diagram, layout.entities, layout.labels);
  scheduleSaveLayout();
}

function handleFitView(): void {
  if (!diagram || !layout) return;

  const svg = getSvg();
  const svgRect = svg.getBoundingClientRect();
  if (Object.keys(diagram.entities).length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const [name, pos] of Object.entries(layout.entities)) {
    const rect = renderer.getEntityRect(name);
    if (!rect) continue;
    found = true;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + rect.width);
    maxY = Math.max(maxY, pos.y + rect.height);
  }
  if (!found) return;

  const contentWidth = maxX - minX + 100;
  const contentHeight = maxY - minY + 100;

  zoom = Math.min(
    svgRect.width / contentWidth,
    svgRect.height / contentHeight,
    2,
  );
  zoom = Math.max(zoom, MIN_ZOOM);

  panX = (svgRect.width - contentWidth * zoom) / 2 - minX * zoom + 50 * zoom;
  panY = (svgRect.height - contentHeight * zoom) / 2 - minY * zoom + 50 * zoom;

  updateViewportTransform();
  if (layout) {
    layout.canvas = { panX, panY, zoom };
    scheduleSaveLayout();
  }
}

function setupPanZoom(): void {
  const svg = getSvg();

  // Zoom with mouse wheel
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * delta));

    // Zoom towards cursor position
    const rect = svg.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    panX = cursorX - (cursorX - panX) * (newZoom / zoom);
    panY = cursorY - (cursorY - panY) * (newZoom / zoom);
    zoom = newZoom;

    updateViewportTransform();
    if (layout) {
      layout.canvas = { panX, panY, zoom };
    }
  }, { passive: false });

  // Pan with middle mouse button or right-click drag
  svg.addEventListener('mousedown', (e) => {
    // Middle button or Ctrl+Left button for panning
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartPanX = panX;
      panStartPanY = panY;
      svg.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
    updateViewportTransform();
  });

  window.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      svg.style.cursor = '';
      if (layout) {
        layout.canvas = { panX, panY, zoom };
        scheduleSaveLayout();
      }
    }
  });

  // Click on empty space to clear highlight
  svg.addEventListener('click', (e) => {
    const target = e.target as SVGElement;
    if (!target.closest('.entity') && selectedEntity) {
      clearHighlight();
    }
  });

  // Prevent context menu on SVG
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setupKeyboard(): void {
  window.addEventListener('keydown', (e) => {
    // F: Fit all
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      handleFitView();
    }

    // L: Auto-layout
    if (e.key === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      handleAutoLayout();
    }

    // Escape: Clear highlight
    if (e.key === 'Escape') {
      clearHighlight();
    }

    // 0/Home: Reset zoom
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      zoom = 1;
      panX = 0;
      panY = 0;
      updateViewportTransform();
    }
  });
}

function setupToolbar(): void {
  document.getElementById('btn-fit')?.addEventListener('click', handleFitView);
  document.getElementById('btn-auto-layout')?.addEventListener('click', handleAutoLayout);
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    zoom = Math.min(MAX_ZOOM, zoom * 1.2);
    updateViewportTransform();
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    zoom = Math.max(MIN_ZOOM, zoom / 1.2);
    updateViewportTransform();
  });
  document.getElementById('btn-back')?.addEventListener('click', async () => {
    try {
      await fetch('/api/close', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch {
      // Ignore errors
    }
    window.location.href = '/';
  });
}

function setupWebSocket(): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;
  const ws = new WebSocketClient(wsUrl);

  ws.on('file-changed', async () => {
    await loadAndRender();
  });

  ws.on('file-closed', () => {
    window.location.href = '/';
  });

  ws.connect();
}

async function init(): Promise<void> {
  // Check if a file is active; if not, redirect to picker
  try {
    const statusRes = await fetch('/api/status');
    if (statusRes.ok) {
      const status = await statusRes.json();
      if (!status.hasActiveFile) {
        window.location.href = '/';
        return;
      }
    }
  } catch {
    // Continue anyway
  }

  const svg = getSvg();
  const viewport = getViewportGroup();

  renderer = new Renderer(svg, viewport);
  dragHandler = new DragHandler(svg, renderer);
  dragHandler.setOnDragEnd(handleDragEnd);
  dragHandler.setOnClick(handleEntityClick);
  dragHandler.attach();

  setupPanZoom();
  setupKeyboard();
  setupToolbar();
  setupWebSocket();

  await loadAndRender();

  // Restore canvas position from layout
  if (layout && layout.canvas) {
    panX = layout.canvas.panX;
    panY = layout.canvas.panY;
    zoom = layout.canvas.zoom;
    updateViewportTransform();
  }
}

document.addEventListener('DOMContentLoaded', init);
