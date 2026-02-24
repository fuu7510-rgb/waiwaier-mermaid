import type { ERDiagramJSON, Entity, Relationship } from '../parser/types.js';
import {
  computeConnectorPath,
  pathToD,
  sideToAngle,
  type EntityRect,
} from './connector.js';
import { drawCardinality } from './cardinality.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 24;
const PADDING_X = 12;
const MIN_WIDTH = 180;

export interface EntitySize {
  width: number;
  height: number;
}

export class Renderer {
  private svg: SVGSVGElement;
  private viewport: SVGGElement;
  private entitiesGroup: SVGGElement;
  private connectorsGroup: SVGGElement;
  private entitySizes: Map<string, EntitySize> = new Map();
  private entityPositions: Map<string, { x: number; y: number }> = new Map();
  private diagram: ERDiagramJSON | null = null;
  private labels: Record<string, string> = {};
  // 最適化1: コネクタ差分更新用インデックス
  private entityRelationshipIndex: Map<string, number[]> = new Map();
  private connectorElements: Map<number, SVGGElement> = new Map();
  // 最適化2: テキスト計測キャッシュ
  private measurementCache: Map<string, { width: number; nameColStart: number }> = new Map();
  private measureText: SVGTextElement | null = null;
  // 最適化3: ビューポートカリング
  private visibleEntities: Set<string> = new Set();
  private visibleConnectors: Set<number> = new Set();
  private viewportBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  constructor(svg: SVGSVGElement, viewport: SVGGElement) {
    this.svg = svg;
    this.viewport = viewport;

    // Create layer groups (connectors behind entities)
    this.connectorsGroup = document.createElementNS(SVG_NS, 'g');
    this.connectorsGroup.classList.add('connectors-layer');
    this.viewport.appendChild(this.connectorsGroup);

    this.entitiesGroup = document.createElementNS(SVG_NS, 'g');
    this.entitiesGroup.classList.add('entities-layer');
    this.viewport.appendChild(this.entitiesGroup);
  }

  getEntitiesGroup(): SVGGElement {
    return this.entitiesGroup;
  }

  private computeMeasurementKey(entity: Entity): string {
    const label = this.labels[entity.name] || '';
    const parts = [entity.name, label];
    for (const attr of entity.attributes) {
      parts.push(attr.type, attr.name, attr.comment || '');
    }
    return parts.join('\x00');
  }

  private getMeasureText(): SVGTextElement {
    if (!this.measureText) {
      this.measureText = document.createElementNS(SVG_NS, 'text');
      this.measureText.style.visibility = 'hidden';
      this.measureText.style.position = 'absolute';
      this.measureText.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";
      this.measureText.setAttribute('aria-hidden', 'true');
      this.svg.appendChild(this.measureText);
    }
    return this.measureText;
  }

  private buildRelationshipIndex(relationships: Relationship[]): void {
    this.entityRelationshipIndex.clear();
    relationships.forEach((rel, index) => {
      for (const name of [rel.entityA, rel.entityB]) {
        if (!this.entityRelationshipIndex.has(name)) {
          this.entityRelationshipIndex.set(name, []);
        }
        this.entityRelationshipIndex.get(name)!.push(index);
      }
    });
  }

  getEntityRect(name: string): EntityRect | null {
    const pos = this.entityPositions.get(name);
    const size = this.entitySizes.get(name);
    if (!pos || !size) return null;
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
  }

  render(
    diagram: ERDiagramJSON,
    positions: Record<string, { x: number; y: number }>,
    labels?: Record<string, string>,
  ): void {
    const newLabels = labels || {};
    const labelsChanged = JSON.stringify(newLabels) !== JSON.stringify(this.labels);
    if (diagram !== this.diagram || labelsChanged) {
      this.measurementCache.clear();
    }
    this.diagram = diagram;
    this.labels = newLabels;
    this.buildRelationshipIndex(diagram.relationships);
    this.entitiesGroup.innerHTML = '';
    this.connectorsGroup.innerHTML = '';
    this.entitySizes.clear();
    this.entityPositions.clear();

    // Render entities
    for (const [name, entity] of Object.entries(diagram.entities)) {
      const pos = positions[name] || { x: 0, y: 0 };
      this.entityPositions.set(name, pos);
      this.renderEntity(entity, pos.x, pos.y);
    }

    // Render relationships
    this.renderAllConnectors(diagram.relationships);

    // カリング状態を初期化(全て表示状態としてマーク)
    this.visibleEntities.clear();
    for (const name of Object.keys(diagram.entities)) {
      this.visibleEntities.add(name);
    }
    this.visibleConnectors.clear();
    diagram.relationships.forEach((_, i) => this.visibleConnectors.add(i));
    this.applyCulling();
  }

  updateEntityPosition(name: string, x: number, y: number): void {
    this.entityPositions.set(name, { x, y });
    const g = this.entitiesGroup.querySelector(`[data-entity="${name}"]`) as SVGGElement | null;
    if (g) {
      g.setAttribute('transform', `translate(${x}, ${y})`);
    }
  }

  updateConnectors(): void {
    if (!this.diagram) return;
    this.renderAllConnectors(this.diagram.relationships);
  }

  private renderEntity(entity: Entity, x: number, y: number): void {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('entity');
    g.setAttribute('data-entity', entity.name);
    g.setAttribute('transform', `translate(${x}, ${y})`);

    const label = this.labels[entity.name];
    const headerHeight = label ? HEADER_HEIGHT + 12 : HEADER_HEIGHT;
    const attrCount = entity.attributes.length;
    const bodyHeight = Math.max(attrCount * ROW_HEIGHT, ROW_HEIGHT);
    const totalHeight = headerHeight + bodyHeight;

    // Measure text widths to determine column layout
    const measured = this.measureEntityLayout(entity);
    const width = measured.width;

    // Header background
    const headerRect = document.createElementNS(SVG_NS, 'rect');
    headerRect.classList.add('entity-header');
    headerRect.setAttribute('width', String(width));
    headerRect.setAttribute('height', String(headerHeight));
    headerRect.setAttribute('rx', '4');
    headerRect.setAttribute('ry', '4');
    g.appendChild(headerRect);

    // Header text
    if (label) {
      // Two-line header: entity name + label
      const headerName = document.createElementNS(SVG_NS, 'text');
      headerName.classList.add('entity-name');
      headerName.setAttribute('x', String(width / 2));
      headerName.setAttribute('y', '15');
      headerName.setAttribute('text-anchor', 'middle');
      headerName.textContent = entity.name;
      g.appendChild(headerName);

      const headerLabel = document.createElementNS(SVG_NS, 'text');
      headerLabel.classList.add('entity-label');
      headerLabel.setAttribute('x', String(width / 2));
      headerLabel.setAttribute('y', '28');
      headerLabel.setAttribute('text-anchor', 'middle');
      headerLabel.textContent = label;
      g.appendChild(headerLabel);
    } else {
      const headerText = document.createElementNS(SVG_NS, 'text');
      headerText.classList.add('entity-name');
      headerText.setAttribute('x', String(width / 2));
      headerText.setAttribute('y', '21');
      headerText.setAttribute('text-anchor', 'middle');
      headerText.textContent = entity.name;
      g.appendChild(headerText);
    }

    // Body background
    const bodyRect = document.createElementNS(SVG_NS, 'rect');
    bodyRect.classList.add('entity-body');
    bodyRect.setAttribute('y', String(headerHeight));
    bodyRect.setAttribute('width', String(width));
    bodyRect.setAttribute('height', String(bodyHeight));
    bodyRect.setAttribute('rx', '0');
    g.appendChild(bodyRect);

    // Bottom rounded corners clip
    const bottomRect = document.createElementNS(SVG_NS, 'rect');
    bottomRect.classList.add('entity-body-bottom');
    bottomRect.setAttribute('y', String(headerHeight));
    bottomRect.setAttribute('width', String(width));
    bottomRect.setAttribute('height', String(bodyHeight));
    bottomRect.setAttribute('rx', '4');
    bottomRect.setAttribute('ry', '4');
    bottomRect.setAttribute('fill', 'none');
    bottomRect.setAttribute('stroke', 'none');

    // Outline for the whole entity
    const outline = document.createElementNS(SVG_NS, 'rect');
    outline.classList.add('entity-outline');
    outline.setAttribute('width', String(width));
    outline.setAttribute('height', String(totalHeight));
    outline.setAttribute('rx', '4');
    outline.setAttribute('ry', '4');
    g.appendChild(outline);

    // Column layout: keys(40) | type(dynamic) | name(dynamic)
    const keyColWidth = 40;
    const typeColStart = keyColWidth + 8;
    const nameColStart = measured.nameColStart;

    // Attributes
    entity.attributes.forEach((attr, i) => {
      const rowG = document.createElementNS(SVG_NS, 'g');
      rowG.classList.add('attribute');
      rowG.setAttribute('transform', `translate(0, ${headerHeight + i * ROW_HEIGHT})`);

      // Separator line
      if (i > 0) {
        const sep = document.createElementNS(SVG_NS, 'line');
        sep.classList.add('attr-separator');
        sep.setAttribute('x1', '0');
        sep.setAttribute('y1', '0');
        sep.setAttribute('x2', String(width));
        sep.setAttribute('y2', '0');
        rowG.appendChild(sep);
      }

      // Key badges
      if (attr.keys.length > 0) {
        const keyText = document.createElementNS(SVG_NS, 'text');
        keyText.classList.add('attr-key');
        keyText.setAttribute('x', String(PADDING_X));
        keyText.setAttribute('y', '17');
        keyText.textContent = attr.keys.join(',');
        rowG.appendChild(keyText);
      }

      // Type
      const typeText = document.createElementNS(SVG_NS, 'text');
      typeText.classList.add('attr-type');
      typeText.setAttribute('x', String(typeColStart));
      typeText.setAttribute('y', '17');
      typeText.textContent = attr.type;
      rowG.appendChild(typeText);

      // Name
      const nameText = document.createElementNS(SVG_NS, 'text');
      nameText.classList.add('attr-name');
      nameText.setAttribute('x', String(nameColStart));
      nameText.setAttribute('y', '17');
      nameText.textContent = attr.name;
      rowG.appendChild(nameText);

      // Comment
      if (attr.comment) {
        const commentText = document.createElementNS(SVG_NS, 'text');
        commentText.classList.add('attr-comment');
        commentText.setAttribute('x', String(width - PADDING_X));
        commentText.setAttribute('y', '17');
        commentText.setAttribute('text-anchor', 'end');
        commentText.textContent = attr.comment;
        rowG.appendChild(commentText);
      }

      g.appendChild(rowG);
    });

    this.entitiesGroup.appendChild(g);
    this.entitySizes.set(entity.name, { width, height: totalHeight });
  }

  /** Measure column widths and total entity width. Returns layout info for rendering. */
  private measureEntityLayout(entity: Entity): {
    width: number;
    nameColStart: number;
  } {
    const key = this.computeMeasurementKey(entity);
    const cached = this.measurementCache.get(key);
    if (cached) return cached;

    const tempText = this.getMeasureText();

    let maxWidth = 0;

    // Measure entity name (centered)
    tempText.style.fontWeight = '600';
    tempText.style.fontSize = '14px';
    tempText.textContent = entity.name;
    maxWidth = Math.max(maxWidth, tempText.getComputedTextLength() + PADDING_X * 2);

    // Measure label if present
    const label = this.labels[entity.name];
    if (label) {
      tempText.style.fontWeight = 'normal';
      tempText.style.fontSize = '11px';
      tempText.textContent = label;
      maxWidth = Math.max(maxWidth, tempText.getComputedTextLength() + PADDING_X * 2);
    }

    // Measure max type width to determine name column start
    tempText.style.fontWeight = 'normal';
    tempText.style.fontSize = '13px';
    const keyColWidth = 40;
    const typeColStart = keyColWidth + 8;
    const typeGap = 10;
    const commentGap = 16;

    let maxTypeWidth = 0;
    for (const attr of entity.attributes) {
      tempText.textContent = attr.type;
      maxTypeWidth = Math.max(maxTypeWidth, tempText.getComputedTextLength());
    }

    const nameColStart = typeColStart + maxTypeWidth + typeGap;

    // Measure total row widths
    for (const attr of entity.attributes) {
      tempText.textContent = attr.name;
      let rowWidth = nameColStart + tempText.getComputedTextLength();

      if (attr.comment) {
        tempText.textContent = attr.comment;
        rowWidth += commentGap + tempText.getComputedTextLength();
      }

      maxWidth = Math.max(maxWidth, rowWidth + PADDING_X);
    }

    const result = { width: Math.max(MIN_WIDTH, maxWidth), nameColStart };
    this.measurementCache.set(key, result);
    return result;
  }

  private renderAllConnectors(relationships: Relationship[]): void {
    this.connectorsGroup.innerHTML = '';
    this.connectorElements.clear();

    relationships.forEach((rel, index) => {
      const rectA = this.getEntityRect(rel.entityA);
      const rectB = this.getEntityRect(rel.entityB);
      if (!rectA || !rectB) return;

      this.renderConnector(rel, index, rectA, rectB);
    });
  }

  private renderConnector(
    rel: Relationship,
    relIndex: number,
    rectA: EntityRect,
    rectB: EntityRect,
  ): void {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('connector');
    g.setAttribute('data-from', rel.entityA);
    g.setAttribute('data-to', rel.entityB);
    g.setAttribute('data-rel-index', String(relIndex));

    const connector = computeConnectorPath(rectA, rectB);

    // Draw the path
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathToD(connector.points));
    path.classList.add('connector-line');
    if (!rel.identifying) {
      path.classList.add('non-identifying');
    }
    g.appendChild(path);

    // Draw cardinality symbols
    // CardinalityA is at the start (near entityA)
    const startAngle = sideToAngle(connector.startSide);
    // Flip: cardinality symbol points toward entity, so rotate 180 degrees
    const cardAX =
      connector.startSide === 'right' ? rectA.x + rectA.width :
      connector.startSide === 'left' ? rectA.x :
      rectA.x + rectA.width / 2;
    const cardAY =
      connector.startSide === 'bottom' ? rectA.y + rectA.height :
      connector.startSide === 'top' ? rectA.y :
      rectA.y + rectA.height / 2;

    drawCardinality(g, rel.cardinalityA, cardAX, cardAY, startAngle, rel.identifying);

    // CardinalityB is at the end (near entityB)
    const endAngle = sideToAngle(connector.endSide);
    const cardBX =
      connector.endSide === 'right' ? rectB.x + rectB.width :
      connector.endSide === 'left' ? rectB.x :
      rectB.x + rectB.width / 2;
    const cardBY =
      connector.endSide === 'bottom' ? rectB.y + rectB.height :
      connector.endSide === 'top' ? rectB.y :
      rectB.y + rectB.height / 2;

    drawCardinality(g, rel.cardinalityB, cardBX, cardBY, endAngle, rel.identifying);

    // Label
    if (rel.label) {
      const midIdx = Math.floor(connector.points.length / 2);
      const midPt = connector.points[midIdx];
      const prevPt = connector.points[Math.max(0, midIdx - 1)];

      const labelText = document.createElementNS(SVG_NS, 'text');
      labelText.classList.add('connector-label');
      labelText.setAttribute('x', String((midPt.x + prevPt.x) / 2));
      labelText.setAttribute('y', String((midPt.y + prevPt.y) / 2 - 8));
      labelText.setAttribute('text-anchor', 'middle');
      labelText.textContent = rel.label;
      g.appendChild(labelText);
    }

    this.connectorsGroup.appendChild(g);
    this.connectorElements.set(relIndex, g);
  }

  updateConnectorsForEntity(entityName: string): void {
    if (!this.diagram) return;
    const relIndices = this.entityRelationshipIndex.get(entityName);
    if (!relIndices) return;
    const seen = new Set<number>();
    for (const index of relIndices) {
      if (seen.has(index)) continue;
      seen.add(index);
      const rel = this.diagram.relationships[index];
      const rectA = this.getEntityRect(rel.entityA);
      const rectB = this.getEntityRect(rel.entityB);
      if (!rectA || !rectB) continue;
      const old = this.connectorElements.get(index);
      if (old) old.remove();
      this.renderConnector(rel, index, rectA, rectB);
    }
  }

  setViewportBounds(svgWidth: number, svgHeight: number, panX: number, panY: number, zoom: number): void {
    this.viewportBounds = {
      minX: (0 - panX) / zoom,
      minY: (0 - panY) / zoom,
      maxX: (svgWidth - panX) / zoom,
      maxY: (svgHeight - panY) / zoom,
    };
  }

  private isEntityVisible(name: string): boolean {
    if (!this.viewportBounds) return true;
    const pos = this.entityPositions.get(name);
    const size = this.entitySizes.get(name);
    if (!pos || !size) return true;

    const MARGIN = 200;
    return !(
      pos.x + size.width < this.viewportBounds.minX - MARGIN ||
      pos.x > this.viewportBounds.maxX + MARGIN ||
      pos.y + size.height < this.viewportBounds.minY - MARGIN ||
      pos.y > this.viewportBounds.maxY + MARGIN
    );
  }

  private isConnectorVisible(relIndex: number): boolean {
    if (!this.diagram) return true;
    const rel = this.diagram.relationships[relIndex];
    return this.isEntityVisible(rel.entityA) || this.isEntityVisible(rel.entityB);
  }

  applyCulling(): void {
    if (!this.diagram) return;

    this.entityPositions.forEach((_, name) => {
      const visible = this.isEntityVisible(name);
      const g = this.entitiesGroup.querySelector(`[data-entity="${name}"]`) as SVGGElement | null;
      if (!g) return;

      if (visible && !this.visibleEntities.has(name)) {
        g.removeAttribute('display');
        this.visibleEntities.add(name);
      } else if (!visible && this.visibleEntities.has(name)) {
        g.setAttribute('display', 'none');
        this.visibleEntities.delete(name);
      }
    });

    this.connectorElements.forEach((g, index) => {
      const visible = this.isConnectorVisible(index);
      if (visible && !this.visibleConnectors.has(index)) {
        g.removeAttribute('display');
        this.visibleConnectors.add(index);
      } else if (!visible && this.visibleConnectors.has(index)) {
        g.setAttribute('display', 'none');
        this.visibleConnectors.delete(index);
      }
    });
  }
}
