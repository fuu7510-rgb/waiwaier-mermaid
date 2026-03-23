import { fetchDiagram, fetchLayout, saveLayout } from './api.js';
import { WebSocketClient } from './websocket.js';
import { Renderer } from './renderer.js';
import { DragHandler } from './drag.js';
import { autoLayoutNewEntities, autoLayoutAll } from './layout.js';
import { HistoryManager } from './history.js';
import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

let diagram: ERDiagramJSON | null = null;
let layout: LayoutData | null = null;
let renderer: Renderer;
let dragHandler: DragHandler;
let saveTimer: number | null = null;
const history = new HistoryManager(50);

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

// Font scale
const FONT_SCALE_STEP = 0.1;
const MIN_FONT_SCALE = 0.5;
const MAX_FONT_SCALE = 2.0;

// ── モード別の位置・キャンバス取得ヘルパー ──

/** 現在のモードに対応するエンティティ位置を返す（参照） */
function activeEntities(): Record<string, { x: number; y: number }> {
  if (!layout) return {};
  if (renderer.compactMode) {
    if (!layout.compactEntities) layout.compactEntities = {};
    return layout.compactEntities;
  }
  return layout.entities;
}

/** 現在のモードのエンティティ位置を上書きする */
function setActiveEntities(positions: Record<string, { x: number; y: number }>): void {
  if (!layout) return;
  if (renderer.compactMode) {
    layout.compactEntities = positions;
  } else {
    layout.entities = positions;
  }
}

/** 現在のモードのキャンバス状態を保存する */
function saveActiveCanvas(): void {
  if (!layout) return;
  const canvas = { panX, panY, zoom };
  if (renderer.compactMode) {
    layout.compactCanvas = canvas;
  } else {
    layout.canvas = canvas;
  }
}

/** 現在のモードのキャンバス状態を返す */
function activeCanvas(): { panX: number; panY: number; zoom: number } | undefined {
  if (!layout) return undefined;
  return renderer.compactMode ? layout.compactCanvas : layout.canvas;
}

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

  // ビューポートカリング
  const svg = getSvg();
  const rect = svg.getBoundingClientRect();
  renderer.setViewportBounds(rect.width, rect.height, panX, panY, zoom);
  renderer.applyCulling();
}

async function flushSaveLayout(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (layout) {
      try {
        await saveLayout(layout);
      } catch {
        // ignore
      }
    }
  }
}

async function loadAndRender(): Promise<void> {
  try {
    // 未保存のレイアウトを先にディスクに書き込む
    await flushSaveLayout();

    diagram = await fetchDiagram();
    layout = await fetchLayout();

    // Auto-layout new entities (通常モード)
    layout = autoLayoutNewEntities(diagram, layout);

    // コンパクトモード中なら compactEntities をダイアグラムと同期
    if (renderer.compactMode) {
      if (!layout.compactEntities) {
        // compactEntities が未保存（タイミング等）→ 通常位置からコピー
        layout.compactEntities = JSON.parse(JSON.stringify(layout.entities));
      } else {
        const diagramNames = new Set(Object.keys(diagram.entities));
        for (const name of diagramNames) {
          if (!layout.compactEntities[name]) {
            layout.compactEntities[name] = layout.entities[name]
              ? { ...layout.entities[name] }
              : { x: 0, y: 0 };
          }
        }
        for (const name of Object.keys(layout.compactEntities)) {
          if (!diagramNames.has(name)) {
            delete layout.compactEntities[name];
          }
        }
      }
    }

    renderer.render(diagram, activeEntities(), layout.labels);
    updateViewportTransform();

    history.init(activeEntities());
    updateUndoRedoButtons();

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
  activeEntities()[entityName] = { x, y };
  history.push(activeEntities());
  updateUndoRedoButtons();
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

// ── ラベル編集（ダブルクリック） ──

function showLabelEditor(entityName: string): void {
  // 既に開いている場合は閉じる
  document.getElementById('label-editor')?.remove();

  const svg = getSvg();
  const svgRect = svg.getBoundingClientRect();
  const entityRect = renderer.getEntityRect(entityName);
  if (!entityRect || !layout) return;

  // SVG座標 → 画面座標
  const screenX = entityRect.x * zoom + panX + svgRect.left;
  const screenY = entityRect.y * zoom + panY + svgRect.top;
  const screenW = entityRect.width * zoom;

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'label-editor';
  input.value = layout.labels?.[entityName] || '';
  input.placeholder = '日本語名を入力…';
  input.style.position = 'fixed';
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.style.width = `${Math.max(screenW, 200)}px`;

  document.body.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  function commit(): void {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (!layout!.labels) layout!.labels = {};
    if (value) {
      layout!.labels![entityName] = value;
    } else {
      delete layout!.labels![entityName];
    }
    input.remove();
    if (diagram) {
      renderer.render(diagram, activeEntities(), layout!.labels);
      updateViewportTransform();
      scheduleSaveLayout();
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { done = true; input.remove(); }
  });
  input.addEventListener('blur', () => commit());
}

function handleCompactToggle(): void {
  if (!diagram || !layout) return;

  // 現在のモードのキャンバス状態を保存
  saveActiveCanvas();

  // モード切替
  renderer.compactMode = !renderer.compactMode;

  // コンパクト位置が未初期化なら通常位置からコピー
  if (renderer.compactMode && !layout.compactEntities) {
    layout.compactEntities = JSON.parse(JSON.stringify(layout.entities));
  }

  // 切替先モードの位置でレンダリング
  const positions = activeEntities();
  renderer.render(diagram, positions, layout.labels);

  // 切替先モードのキャンバス状態を復元
  const canvas = activeCanvas();
  if (canvas) {
    panX = canvas.panX;
    panY = canvas.panY;
    zoom = canvas.zoom;
  }
  updateViewportTransform();

  // Undo/Redo 履歴を切替先モード用に初期化
  history.init(positions);
  updateUndoRedoButtons();

  const btn = document.getElementById('btn-compact');
  if (btn) {
    btn.classList.toggle('active', renderer.compactMode);
  }

  scheduleSaveLayout();
}

function handleAutoLayout(): void {
  if (!diagram || !layout) return;
  const positions = autoLayoutAll(diagram);
  setActiveEntities(positions);
  renderer.render(diagram, activeEntities(), layout.labels);
  history.push(activeEntities());
  updateUndoRedoButtons();
  scheduleSaveLayout();
}

function handleUndo(): void {
  if (!diagram || !layout) return;
  const positions = history.undo();
  if (!positions) return;
  setActiveEntities(positions);
  renderer.render(diagram, activeEntities(), layout.labels);
  updateUndoRedoButtons();
  scheduleSaveLayout();
}

function handleRedo(): void {
  if (!diagram || !layout) return;
  const positions = history.redo();
  if (!positions) return;
  setActiveEntities(positions);
  renderer.render(diagram, activeEntities(), layout.labels);
  updateUndoRedoButtons();
  scheduleSaveLayout();
}

function updateUndoRedoButtons(): void {
  const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement | null;
  const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = !history.canUndo;
  if (redoBtn) redoBtn.disabled = !history.canRedo;
}

function handleFitView(): void {
  if (!diagram || !layout) return;

  const svg = getSvg();
  const svgRect = svg.getBoundingClientRect();
  if (Object.keys(diagram.entities).length === 0) return;

  const positions = activeEntities();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const [name, pos] of Object.entries(positions)) {
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
    saveActiveCanvas();
    scheduleSaveLayout();
  }
}

function setupPanZoom(): void {
  const svg = getSvg();

  // Wheel event: Ctrl+wheel = zoom, plain wheel = pan
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();

    if (e.ctrlKey) {
      // Ctrl+wheel (mouse scroll wheel or touchpad pinch) → Zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * delta));

      // Zoom towards cursor position
      const rect = svg.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      panX = cursorX - (cursorX - panX) * (newZoom / zoom);
      panY = cursorY - (cursorY - panY) * (newZoom / zoom);
      zoom = newZoom;
    } else {
      // Plain wheel (mouse scroll or touchpad two-finger scroll) → Pan
      panX -= e.deltaX;
      panY -= e.deltaY;
    }

    updateViewportTransform();
    if (layout) {
      saveActiveCanvas();
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
        saveActiveCanvas();
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
      if (!entityName || !layout) return;
      e.preventDefault();
      showLabelEditor(entityName);
      return;
    }

  });

  // Prevent context menu on SVG
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setupKeyboard(): void {
  window.addEventListener('keydown', (e) => {
    // Ctrl+Z: Undo
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }

    // Ctrl+Y or Ctrl+Shift+Z: Redo
    if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
        (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
      e.preventDefault();
      handleRedo();
      return;
    }

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

    // C: Compact mode toggle
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      handleCompactToggle();
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

function changeFontScale(delta: number): void {
  const newScale = Math.round(Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, renderer.fontScale + delta)) * 10) / 10;
  renderer.fontScale = newScale;
  localStorage.setItem('er-font-scale', String(newScale));
  updateFontScaleLabel();
  if (diagram && layout) {
    renderer.render(diagram, activeEntities(), layout.labels);
    updateViewportTransform();
  }
}

function updateFontScaleLabel(): void {
  const label = document.getElementById('font-size-label');
  if (label) label.textContent = `${Math.round(renderer.fontScale * 100)}%`;
}

function setupToolbar(): void {
  document.getElementById('btn-undo')?.addEventListener('click', handleUndo);
  document.getElementById('btn-redo')?.addEventListener('click', handleRedo);
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
  document.getElementById('btn-compact')?.addEventListener('click', handleCompactToggle);
  document.getElementById('btn-font-down')?.addEventListener('click', () => changeFontScale(-FONT_SCALE_STEP));
  document.getElementById('btn-font-up')?.addEventListener('click', () => changeFontScale(FONT_SCALE_STEP));
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

  ws.on('layout-changed', async () => {
    // 外部で .layout.json が編集された（別のAI等）
    // 未保存分をフラッシュしてからディスクからフル更新する
    if (!diagram || !layout) return;
    try {
      await flushSaveLayout();
      const diskLayout = await fetchLayout();
      layout.labels = diskLayout.labels;
      layout.entities = diskLayout.entities;
      layout.canvas = diskLayout.canvas;
      if (diskLayout.compactEntities) {
        layout.compactEntities = diskLayout.compactEntities;
      }
      if (diskLayout.compactCanvas) {
        layout.compactCanvas = diskLayout.compactCanvas;
      }
      renderer.render(diagram, activeEntities(), layout.labels);
      updateViewportTransform();
      history.init(activeEntities());
      updateUndoRedoButtons();
      showToast('Layout updated (external edit)');
    } catch {
      // ignore
    }
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

  // Restore font scale from localStorage
  const savedFontScale = localStorage.getItem('er-font-scale');
  if (savedFontScale) {
    renderer.fontScale = parseFloat(savedFontScale);
  }
  updateFontScaleLabel();
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
  const savedCanvas = activeCanvas();
  if (savedCanvas) {
    panX = savedCanvas.panX;
    panY = savedCanvas.panY;
    zoom = savedCanvas.zoom;
    updateViewportTransform();
  }
}

document.addEventListener('DOMContentLoaded', init);
