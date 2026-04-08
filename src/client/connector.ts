export interface EntityRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectionPoint {
  x: number;
  y: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}

export interface ConnectorPath {
  points: { x: number; y: number }[];
  startSide: 'top' | 'bottom' | 'left' | 'right';
  endSide: 'top' | 'bottom' | 'left' | 'right';
  portA: { x: number; y: number };
  portB: { x: number; y: number };
}

type Side = 'top' | 'bottom' | 'left' | 'right';

/** Get center of an entity rect */
function center(r: EntityRect): { cx: number; cy: number } {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}

/** Determine best connection sides based on relative positions */
function chooseSides(
  a: EntityRect,
  b: EntityRect,
): { sideA: ConnectionPoint; sideB: ConnectionPoint } {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.cx - ca.cx;
  const dy = cb.cy - ca.cy;

  let sideA: ConnectionPoint;
  let sideB: ConnectionPoint;

  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal arrangement
    if (dx > 0) {
      // B is to the right of A
      sideA = { x: a.x + a.width, y: ca.cy, side: 'right' };
      sideB = { x: b.x, y: cb.cy, side: 'left' };
    } else {
      // B is to the left of A
      sideA = { x: a.x, y: ca.cy, side: 'left' };
      sideB = { x: b.x + b.width, y: cb.cy, side: 'right' };
    }
  } else {
    // Vertical arrangement
    if (dy > 0) {
      // B is below A
      sideA = { x: ca.cx, y: a.y + a.height, side: 'bottom' };
      sideB = { x: cb.cx, y: b.y, side: 'top' };
    } else {
      // B is above A
      sideA = { x: ca.cx, y: a.y, side: 'top' };
      sideB = { x: cb.cx, y: b.y + b.height, side: 'bottom' };
    }
  }

  return { sideA, sideB };
}

const ELBOW_OFFSET = 30;
const PORT_PADDING = 20;
const SPREAD_SPACING = 20;

export interface PortAssignment {
  portA: ConnectionPoint;
  portB: ConnectionPoint;
  midOffset: number;
}

/** Assign distributed port positions for all relationships */
export function assignPorts(
  relationships: Array<{ entityA: string; entityB: string }>,
  getEntityRect: (name: string) => EntityRect | null,
): Map<number, PortAssignment> {
  const result = new Map<number, PortAssignment>();

  // Step 1: determine sides for each relationship
  const sideInfos: ({ sideA: ConnectionPoint; sideB: ConnectionPoint } | null)[] =
    relationships.map((rel) => {
      const rectA = getEntityRect(rel.entityA);
      const rectB = getEntityRect(rel.entityB);
      if (!rectA || !rectB) return null;
      return chooseSides(rectA, rectB);
    });

  // Step 2: build entity-side groups
  // Key: "entityName\0side" → Array of connections on that edge
  const groups = new Map<
    string,
    Array<{ relIndex: number; isA: boolean; peerCenter: { x: number; y: number } }>
  >();

  relationships.forEach((rel, index) => {
    const info = sideInfos[index];
    if (!info) return;

    const rectA = getEntityRect(rel.entityA);
    const rectB = getEntityRect(rel.entityB);
    if (!rectA || !rectB) return;

    const cA = center(rectA);
    const cB = center(rectB);

    const keyA = `${rel.entityA}\0${info.sideA.side}`;
    if (!groups.has(keyA)) groups.set(keyA, []);
    groups.get(keyA)!.push({
      relIndex: index,
      isA: true,
      peerCenter: { x: cB.cx, y: cB.cy },
    });

    const keyB = `${rel.entityB}\0${info.sideB.side}`;
    if (!groups.has(keyB)) groups.set(keyB, []);
    groups.get(keyB)!.push({
      relIndex: index,
      isA: false,
      peerCenter: { x: cA.cx, y: cA.cy },
    });
  });

  // Step 3: sort each group by peer center and assign port positions
  const portPositions = new Map<string, ConnectionPoint>();

  groups.forEach((group, key) => {
    const sepIdx = key.indexOf('\0');
    const entityName = key.substring(0, sepIdx);
    const side = key.substring(sepIdx + 1) as Side;
    const rect = getEntityRect(entityName);
    if (!rect) return;

    // Sort by peer center coordinate
    if (side === 'left' || side === 'right') {
      group.sort((a, b) => a.peerCenter.y - b.peerCenter.y);
    } else {
      group.sort((a, b) => a.peerCenter.x - b.peerCenter.x);
    }

    // Distribute ports evenly along the edge
    const N = group.length;
    const edgeLength = (side === 'left' || side === 'right') ? rect.height : rect.width;
    const usableLength = Math.max(0, edgeLength - 2 * PORT_PADDING);
    const spacing = usableLength / (N + 1);

    group.forEach((item, i) => {
      const offset = PORT_PADDING + spacing * (i + 1);
      let port: ConnectionPoint;

      switch (side) {
        case 'left':
          port = { x: rect.x, y: rect.y + offset, side };
          break;
        case 'right':
          port = { x: rect.x + rect.width, y: rect.y + offset, side };
          break;
        case 'top':
          port = { x: rect.x + offset, y: rect.y, side };
          break;
        case 'bottom':
          port = { x: rect.x + offset, y: rect.y + rect.height, side };
          break;
      }

      portPositions.set(`${item.relIndex}:${item.isA ? 'A' : 'B'}`, port);
    });
  });

  // Step 4: calculate mid-offsets for edges sharing the same entity side + side pattern
  const midGroups = new Map<string, number[]>();

  relationships.forEach((rel, index) => {
    const info = sideInfos[index];
    if (!info) return;
    const midKey = `${rel.entityA}\0${info.sideA.side}\0${info.sideB.side}`;
    if (!midGroups.has(midKey)) midGroups.set(midKey, []);
    midGroups.get(midKey)!.push(index);
  });

  const midOffsets = new Map<number, number>();
  midGroups.forEach((indices) => {
    const count = indices.length;
    indices.forEach((relIndex, i) => {
      midOffsets.set(relIndex, (i - (count - 1) / 2) * SPREAD_SPACING);
    });
  });

  // Step 5: build result
  relationships.forEach((_, index) => {
    const portA = portPositions.get(`${index}:A`);
    const portB = portPositions.get(`${index}:B`);
    if (!portA || !portB) return;

    result.set(index, {
      portA,
      portB,
      midOffset: midOffsets.get(index) || 0,
    });
  });

  return result;
}

/** Compute orthogonal connector path between two entity rects */
export function computeConnectorPath(
  rectA: EntityRect,
  rectB: EntityRect,
  portA?: ConnectionPoint,
  portB?: ConnectionPoint,
  midOffset?: number,
): ConnectorPath {
  let sideA: ConnectionPoint;
  let sideB: ConnectionPoint;

  if (portA && portB) {
    sideA = portA;
    sideB = portB;
  } else {
    const sides = chooseSides(rectA, rectB);
    sideA = sides.sideA;
    sideB = sides.sideB;
  }

  // Store raw port positions (on entity edge, before cardOffset)
  const rawPortA = { x: sideA.x, y: sideA.y };
  const rawPortB = { x: sideB.x, y: sideB.y };

  const points: { x: number; y: number }[] = [];
  const mo = midOffset || 0;

  // Start point (with offset for cardinality symbol)
  const cardOffset = 28;
  let startX = sideA.x;
  let startY = sideA.y;
  let endX = sideB.x;
  let endY = sideB.y;

  // Apply cardinality symbol offset
  if (sideA.side === 'right') startX += cardOffset;
  else if (sideA.side === 'left') startX -= cardOffset;
  else if (sideA.side === 'bottom') startY += cardOffset;
  else if (sideA.side === 'top') startY -= cardOffset;

  if (sideB.side === 'right') endX += cardOffset;
  else if (sideB.side === 'left') endX -= cardOffset;
  else if (sideB.side === 'bottom') endY += cardOffset;
  else if (sideB.side === 'top') endY -= cardOffset;

  points.push({ x: startX, y: startY });

  // Orthogonal routing
  if (
    (sideA.side === 'right' && sideB.side === 'left') ||
    (sideA.side === 'left' && sideB.side === 'right')
  ) {
    // Horizontal: use midpoint for elbow, apply mid-offset
    const midX = (startX + endX) / 2 + mo;
    points.push({ x: midX, y: startY });
    points.push({ x: midX, y: endY });
  } else if (
    (sideA.side === 'bottom' && sideB.side === 'top') ||
    (sideA.side === 'top' && sideB.side === 'bottom')
  ) {
    // Vertical: use midpoint for elbow, apply mid-offset
    const midY = (startY + endY) / 2 + mo;
    points.push({ x: startX, y: midY });
    points.push({ x: endX, y: midY });
  } else if (
    (sideA.side === 'right' || sideA.side === 'left') &&
    (sideB.side === 'top' || sideB.side === 'bottom')
  ) {
    // L-shape: horizontal then vertical
    points.push({ x: endX, y: startY });
  } else if (
    (sideA.side === 'top' || sideA.side === 'bottom') &&
    (sideB.side === 'left' || sideB.side === 'right')
  ) {
    // L-shape: vertical then horizontal
    points.push({ x: startX, y: endY });
  } else {
    // Same-side connections: route around
    if (sideA.side === 'right' && sideB.side === 'right') {
      const maxX = Math.max(startX, endX) + ELBOW_OFFSET;
      points.push({ x: maxX, y: startY });
      points.push({ x: maxX, y: endY });
    } else if (sideA.side === 'left' && sideB.side === 'left') {
      const minX = Math.min(startX, endX) - ELBOW_OFFSET;
      points.push({ x: minX, y: startY });
      points.push({ x: minX, y: endY });
    } else if (sideA.side === 'top' && sideB.side === 'top') {
      const minY = Math.min(startY, endY) - ELBOW_OFFSET;
      points.push({ x: startX, y: minY });
      points.push({ x: endX, y: minY });
    } else if (sideA.side === 'bottom' && sideB.side === 'bottom') {
      const maxY = Math.max(startY, endY) + ELBOW_OFFSET;
      points.push({ x: startX, y: maxY });
      points.push({ x: endX, y: maxY });
    }
  }

  points.push({ x: endX, y: endY });

  return {
    points,
    startSide: sideA.side,
    endSide: sideB.side,
    portA: rawPortA,
    portB: rawPortB,
  };
}

/** Convert connector path to SVG path "d" attribute */
export function pathToD(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

/** Get angle (degrees) for cardinality symbol based on connection side */
export function sideToAngle(side: 'top' | 'bottom' | 'left' | 'right'): number {
  switch (side) {
    case 'right': return 0;
    case 'bottom': return 90;
    case 'left': return 180;
    case 'top': return 270;
  }
}
