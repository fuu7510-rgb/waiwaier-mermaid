// src/client/minimap.ts
import type { LayoutData } from '../parser/types.js';

export interface MinimapDeps {
  getLayout: () => LayoutData | null;
  getEntitySizes: () => Map<string, { width: number; height: number }>;
  getPanZoom: () => { panX: number; panY: number; zoom: number };
  getSvgSize: () => { width: number; height: number };
  onNavigate: (panX: number, panY: number) => void;
  getGroupColor?: (entityName: string) => string | null;
}

export class Minimap {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private deps: MinimapDeps;
  private visible = true;
  private rafId = 0;
  private isDragging = false;
  private _transform: { minX: number; minY: number; scale: number } | null = null;

  constructor(container: HTMLDivElement, deps: MinimapDeps) {
    this.container = container;
    this.canvas = container.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.deps = deps;
    this.setupInteraction();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.scheduleRedraw();
  }

  scheduleRedraw(): void {
    if (!this.visible) return;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.draw();
    });
  }

  private draw(): void {
    const layout = this.deps.getLayout();
    if (!layout) return;

    const entities = layout.entities;
    const sizes = this.deps.getEntitySizes();
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    this.ctx.clearRect(0, 0, cw, ch);

    // Calculate bounding box of all entities
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [name, pos] of Object.entries(entities)) {
      const size = sizes.get(name) || { width: 180, height: 100 };
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }

    if (minX === Infinity) return;

    const pad = 50;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    const scale = Math.min(cw / worldW, ch / worldH);

    // Draw entities as rectangles
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7aa2f7';
    const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#24283b';

    for (const [name, pos] of Object.entries(entities)) {
      const size = sizes.get(name) || { width: 180, height: 100 };
      const x = (pos.x - minX) * scale;
      const y = (pos.y - minY) * scale;
      const w = size.width * scale;
      const h = size.height * scale;

      const groupColor = this.deps.getGroupColor?.(name);
      this.ctx.fillStyle = groupColor || surfaceColor;
      this.ctx.fillRect(x, y, w, h);
      this.ctx.strokeStyle = accentColor;
      this.ctx.lineWidth = 0.5;
      this.ctx.strokeRect(x, y, w, h);
    }

    // Draw viewport rectangle
    const pz = this.deps.getPanZoom();
    const svgSize = this.deps.getSvgSize();
    const vpX = (-pz.panX / pz.zoom - minX) * scale;
    const vpY = (-pz.panY / pz.zoom - minY) * scale;
    const vpW = (svgSize.width / pz.zoom) * scale;
    const vpH = (svgSize.height / pz.zoom) * scale;

    this.ctx.strokeStyle = accentColor;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(vpX, vpY, vpW, vpH);
    this.ctx.fillStyle = accentColor + '22';
    this.ctx.fillRect(vpX, vpY, vpW, vpH);

    // Store transform info for click handling
    this._transform = { minX, minY, scale };
  }

  private setupInteraction(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.navigateToPoint(e);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) this.navigateToPoint(e);
    });
    window.addEventListener('mouseup', () => { this.isDragging = false; });
  }

  private navigateToPoint(e: MouseEvent): void {
    const t = this._transform;
    if (!t) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pz = this.deps.getPanZoom();
    const svgSize = this.deps.getSvgSize();

    // Convert canvas coords to world coords
    const worldX = mx / t.scale + t.minX;
    const worldY = my / t.scale + t.minY;

    // Center viewport on this point
    const newPanX = svgSize.width / 2 - worldX * pz.zoom;
    const newPanY = svgSize.height / 2 - worldY * pz.zoom;
    this.deps.onNavigate(newPanX, newPanY);
  }
}
