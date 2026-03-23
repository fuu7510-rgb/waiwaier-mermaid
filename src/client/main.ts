import { fetchDiagram, fetchLayout, saveLayout } from './api.js';
import { WebSocketClient } from './websocket.js';
import { Renderer } from './renderer.js';
import { DragHandler } from './drag.js';
import { autoLayoutNewEntities, autoLayoutAll } from './layout.js';
import { HistoryManager } from './history.js';
import { createPanZoomState, setupPanZoom, MIN_ZOOM, MAX_ZOOM } from './pan-zoom.js';
import {
  createHighlightState,
  handleEntityClick as hlHandleEntityClick,
  clearHighlight,
} from './highlight.js';
import { showLabelEditor } from './label-editor.js';
import { exportSVG, exportPNG, copyToClipboard } from './export.js';
import { showToast } from './toast.js';
import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

let diagram: ERDiagramJSON | null = null;
let layout: LayoutData | null = null;
let renderer: Renderer;
let dragHandler: DragHandler;
let saveTimer: number | null = null;
const history = new HistoryManager(50);

// Pan & Zoom state
const pz = createPanZoomState();

// Highlight state
const hl = createHighlightState();

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
  const canvas = { panX: pz.panX, panY: pz.panY, zoom: pz.zoom };
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
  vp.setAttribute('transform', `translate(${pz.panX}, ${pz.panY}) scale(${pz.zoom})`);
  dragHandler.setTransform(pz.panX, pz.panY, pz.zoom);

  // ビューポートカリング
  const svg = getSvg();
  const rect = svg.getBoundingClientRect();
  renderer.setViewportBounds(rect.width, rect.height, pz.panX, pz.panY, pz.zoom);
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

// Highlight deps (shared across modules)
const hlDeps = {
  getDiagram: () => diagram,
  getSvg,
  showToast,
};

function handleEntityClick(target: SVGElement, entityName: string): void {
  hlHandleEntityClick(hl, hlDeps, target, entityName);
}

// Label editor deps (lazy — uses current state at call time)
const labelEditorDeps = {
  getLayout: () => layout,
  getSvg,
  getZoom: () => pz.zoom,
  getPanX: () => pz.panX,
  getPanY: () => pz.panY,
  getEntityRect: (name: string) => renderer.getEntityRect(name),
  scheduleSaveLayout,
  rerender: () => {
    if (diagram) {
      renderer.render(diagram, activeEntities(), layout?.labels);
      updateViewportTransform();
    }
  },
};

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
    pz.panX = canvas.panX;
    pz.panY = canvas.panY;
    pz.zoom = canvas.zoom;
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

  pz.zoom = Math.min(
    svgRect.width / contentWidth,
    svgRect.height / contentHeight,
    2,
  );
  pz.zoom = Math.max(pz.zoom, MIN_ZOOM);

  pz.panX = (svgRect.width - contentWidth * pz.zoom) / 2 - minX * pz.zoom + 50 * pz.zoom;
  pz.panY = (svgRect.height - contentHeight * pz.zoom) / 2 - minY * pz.zoom + 50 * pz.zoom;

  updateViewportTransform();
  if (layout) {
    saveActiveCanvas();
    scheduleSaveLayout();
  }
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
      clearHighlight(hl, hlDeps);
    }

    // 0/Home: Reset zoom
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      pz.zoom = 1;
      pz.panX = 0;
      pz.panY = 0;
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
    pz.zoom = Math.min(MAX_ZOOM, pz.zoom * 1.2);
    updateViewportTransform();
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    pz.zoom = Math.max(MIN_ZOOM, pz.zoom / 1.2);
    updateViewportTransform();
  });
  document.getElementById('btn-compact')?.addEventListener('click', handleCompactToggle);
  document.getElementById('btn-font-down')?.addEventListener('click', () => changeFontScale(-FONT_SCALE_STEP));
  document.getElementById('btn-font-up')?.addEventListener('click', () => changeFontScale(FONT_SCALE_STEP));
  document.getElementById('btn-export-svg')?.addEventListener('click', () => {
    const filename = layout?.diagramFile?.replace('.mmd', '.svg') || 'diagram.svg';
    exportSVG(getSvg(), filename);
  });
  document.getElementById('btn-export-png')?.addEventListener('click', () => {
    const filename = layout?.diagramFile?.replace('.mmd', '.png') || 'diagram.png';
    exportPNG(getSvg(), filename);
  });
  document.getElementById('btn-clipboard')?.addEventListener('click', () => {
    copyToClipboard(getSvg());
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

  setupPanZoom(pz, {
    svg,
    getSelectedEntity: () => hl.selectedEntity,
    onTransformChange: updateViewportTransform,
    onCanvasSave: () => { if (layout) saveActiveCanvas(); },
    onCanvasSaveAndSchedule: () => { if (layout) { saveActiveCanvas(); scheduleSaveLayout(); } },
    onClearHighlight: () => clearHighlight(hl, hlDeps),
    onEntityDblClick: (entityName) => { if (layout) showLabelEditor(labelEditorDeps, entityName); },
  });
  setupKeyboard();
  setupToolbar();
  setupWebSocket();

  await loadAndRender();

  // Restore canvas position from layout
  const savedCanvas = activeCanvas();
  if (savedCanvas) {
    pz.panX = savedCanvas.panX;
    pz.panY = savedCanvas.panY;
    pz.zoom = savedCanvas.zoom;
    updateViewportTransform();
  }
}

document.addEventListener('DOMContentLoaded', init);
