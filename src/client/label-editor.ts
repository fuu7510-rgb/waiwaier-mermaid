import type { LayoutData } from '../parser/types.js';

export interface LabelEditorDeps {
  getLayout: () => LayoutData | null;
  getSvg: () => SVGSVGElement;
  getZoom: () => number;
  getPanX: () => number;
  getPanY: () => number;
  getEntityRect: (name: string) => { x: number; y: number; width: number; height: number } | null;
  scheduleSaveLayout: () => void;
  rerender: () => void;
}

export function showLabelEditor(deps: LabelEditorDeps, entityName: string): void {
  // 既に開いている場合は閉じる
  document.getElementById('label-editor')?.remove();

  const svg = deps.getSvg();
  const svgRect = svg.getBoundingClientRect();
  const entityRect = deps.getEntityRect(entityName);
  const layout = deps.getLayout();
  if (!entityRect || !layout) return;

  // SVG座標 → 画面座標
  const zoom = deps.getZoom();
  const panX = deps.getPanX();
  const panY = deps.getPanY();
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
    const currentLayout = deps.getLayout();
    if (!currentLayout) { input.remove(); return; }
    const value = input.value.trim();
    if (!currentLayout.labels) currentLayout.labels = {};
    if (value) {
      currentLayout.labels[entityName] = value;
    } else {
      delete currentLayout.labels[entityName];
    }
    input.remove();
    deps.rerender();
    deps.scheduleSaveLayout();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { done = true; input.remove(); }
  });
  input.addEventListener('blur', () => commit());
}
