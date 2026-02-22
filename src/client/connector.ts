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
}

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

/** Compute orthogonal connector path between two entity rects */
export function computeConnectorPath(
  rectA: EntityRect,
  rectB: EntityRect,
): ConnectorPath {
  const { sideA, sideB } = chooseSides(rectA, rectB);

  const points: { x: number; y: number }[] = [];

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
    // Horizontal: use midpoint for elbow
    const midX = (startX + endX) / 2;
    points.push({ x: midX, y: startY });
    points.push({ x: midX, y: endY });
  } else if (
    (sideA.side === 'bottom' && sideB.side === 'top') ||
    (sideA.side === 'top' && sideB.side === 'bottom')
  ) {
    // Vertical: use midpoint for elbow
    const midY = (startY + endY) / 2;
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
    const offset =
      sideA.side === 'right' || sideA.side === 'left' ? ELBOW_OFFSET : 0;
    const vOffset =
      sideA.side === 'top' || sideA.side === 'bottom' ? ELBOW_OFFSET : 0;

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
