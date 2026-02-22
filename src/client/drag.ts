import { Renderer } from './renderer.js';

export type DragEndCallback = (entityName: string, x: number, y: number) => void;
export type ClickCallback = (target: SVGElement, entityName: string) => void;

const CLICK_THRESHOLD = 4; // px - below this, treat as click not drag

export class DragHandler {
  private isDragging = false;
  private didMove = false;
  private dragTarget: SVGGElement | null = null;
  private clickTarget: SVGElement | null = null;
  private dragEntityName: string = '';
  private startMouseX = 0;
  private startMouseY = 0;
  private startEntityX = 0;
  private startEntityY = 0;
  private rafId: number | null = null;
  private currentX = 0;
  private currentY = 0;
  private onDragEnd: DragEndCallback | null = null;
  private onClick: ClickCallback | null = null;
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  constructor(
    private svg: SVGSVGElement,
    private renderer: Renderer,
  ) {
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
  }

  setOnDragEnd(cb: DragEndCallback): void {
    this.onDragEnd = cb;
  }

  setOnClick(cb: ClickCallback): void {
    this.onClick = cb;
  }

  setTransform(panX: number, panY: number, zoom: number): void {
    this.panX = panX;
    this.panY = panY;
    this.zoom = zoom;
  }

  attach(): void {
    this.svg.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
  }

  detach(): void {
    this.svg.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
  }

  private handleMouseDown(e: MouseEvent): void {
    const entityG = (e.target as SVGElement).closest('.entity') as SVGGElement | null;
    if (!entityG) return;

    e.preventDefault();
    this.isDragging = true;
    this.didMove = false;
    this.dragTarget = entityG;
    this.clickTarget = e.target as SVGElement;
    this.dragEntityName = entityG.getAttribute('data-entity') || '';

    this.startMouseX = e.clientX;
    this.startMouseY = e.clientY;

    // Parse current transform
    const transform = entityG.getAttribute('transform') || '';
    const match = transform.match(/translate\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)/);
    this.startEntityX = match ? parseFloat(match[1]) : 0;
    this.startEntityY = match ? parseFloat(match[2]) : 0;

    this.currentX = this.startEntityX;
    this.currentY = this.startEntityY;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.dragTarget) return;

    const dx = e.clientX - this.startMouseX;
    const dy = e.clientY - this.startMouseY;

    // Only start visual drag after threshold
    if (!this.didMove && Math.abs(dx) + Math.abs(dy) < CLICK_THRESHOLD) return;

    if (!this.didMove) {
      this.didMove = true;
      this.dragTarget.parentElement?.appendChild(this.dragTarget);
      this.dragTarget.classList.add('dragging');
    }

    this.currentX = this.startEntityX + dx / this.zoom;
    this.currentY = this.startEntityY + dy / this.zoom;

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (!this.dragTarget) return;
        this.renderer.updateEntityPosition(this.dragEntityName, this.currentX, this.currentY);
        this.renderer.updateConnectors();
      });
    }
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (!this.isDragging || !this.dragTarget) return;

    this.dragTarget.classList.remove('dragging');
    this.isDragging = false;

    if (this.didMove) {
      // Was a drag
      if (this.onDragEnd && this.dragEntityName) {
        this.onDragEnd(this.dragEntityName, this.currentX, this.currentY);
      }
    } else {
      // Was a click (no significant movement)
      if (this.onClick && this.clickTarget) {
        this.onClick(this.clickTarget, this.dragEntityName);
      }
    }

    this.dragTarget = null;
    this.clickTarget = null;
    this.dragEntityName = '';
  }
}
