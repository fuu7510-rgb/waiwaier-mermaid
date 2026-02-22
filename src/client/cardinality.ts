import type { Cardinality } from '../parser/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Draw cardinality symbol at a given position along a direction.
 * The symbol is drawn at (x, y) extending towards the entity.
 * angle: rotation in degrees (0 = pointing right, 90 = pointing down, etc.)
 */
export function drawCardinality(
  parent: SVGGElement,
  card: Cardinality,
  x: number,
  y: number,
  angle: number,
  identifying: boolean,
): void {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', `translate(${x}, ${y}) rotate(${angle})`);
  g.classList.add('cardinality');

  // Draw from the line end towards the entity (positive x direction)
  // Symbols occupy roughly 0..20px along the x axis

  if (card.max === 'many') {
    // Crow's foot: three lines fanning out
    drawLine(g, 0, 0, 16, -10);
    drawLine(g, 0, 0, 16, 0);
    drawLine(g, 0, 0, 16, 10);
  } else {
    // One: single vertical line
    drawLine(g, 10, -10, 10, 10);
  }

  if (card.min === 'zero') {
    // Circle for "zero"
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', card.max === 'many' ? '22' : '20');
    circle.setAttribute('cy', '0');
    circle.setAttribute('r', '5');
    circle.classList.add('card-circle');
    g.appendChild(circle);
  } else {
    // One: additional vertical line
    const offset = card.max === 'many' ? 20 : 18;
    drawLine(g, offset, -10, offset, 10);
  }

  parent.appendChild(g);
}

function drawLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number): void {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.classList.add('card-line');
  parent.appendChild(line);
}
