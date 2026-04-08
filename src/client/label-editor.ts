import type { ERDiagramJSON } from '../parser/types.js';

export interface LabelEditorDeps {
  getDiagram: () => ERDiagramJSON | null;
  getSvg: () => SVGSVGElement;
  getZoom: () => number;
  getPanX: () => number;
  getPanY: () => number;
  getEntityRect: (name: string) => { x: number; y: number; width: number; height: number } | null;
}

export function showLabelEditor(deps: LabelEditorDeps, entityName: string): void {
  // 既に開いている場合は閉じる
  document.getElementById('label-editor')?.remove();

  const svg = deps.getSvg();
  const svgRect = svg.getBoundingClientRect();
  const entityRect = deps.getEntityRect(entityName);
  const diagram = deps.getDiagram();
  if (!entityRect || !diagram) return;

  const entity = diagram.entities[entityName];
  const currentLabel = entity?.label || '';

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
  input.value = currentLabel;
  input.placeholder = '.mmd ファイルで ENTITY["ラベル"] を編集';
  input.readOnly = true;
  input.style.position = 'fixed';
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.style.width = `${Math.max(screenW, 200)}px`;

  document.body.appendChild(input);
  input.focus();
  input.select();

  function close(): void {
    input.remove();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => close());
}
