// src/client/export.ts

export function exportSVG(svgElement: SVGSVGElement, filename: string): void {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  const viewport = clone.querySelector('#viewport') as SVGGElement;

  // Remove viewport transform to get raw coordinates
  viewport.removeAttribute('transform');

  // Inline CSS styles for self-contained SVG
  inlineStyles(clone);

  // Calculate bounding box of all entities
  const bbox = calculateBBox(svgElement);
  const padding = 20;
  clone.setAttribute('viewBox',
    `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`
  );
  clone.setAttribute('width', String(bbox.width + padding * 2));
  clone.setAttribute('height', String(bbox.height + padding * 2));
  clone.removeAttribute('id');

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}

function inlineStyles(svg: SVGSVGElement): void {
  const computed = getComputedStyle(document.documentElement);
  const cssVars = [
    '--bg', '--surface', '--header-bg', '--header-text', '--body-bg',
    '--text', '--text-muted', '--key-color', '--type-color', '--name-color',
    '--comment-color', '--connector-color', '--connector-label', '--border',
    '--accent', '--font-scale',
  ];
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  let css = ':root {';
  for (const v of cssVars) {
    const val = computed.getPropertyValue(v).trim();
    if (val) css += `${v}: ${val};`;
  }
  css += '}';
  style.textContent = css;
  svg.insertBefore(style, svg.firstChild);
}

function calculateBBox(svg: SVGSVGElement): DOMRect {
  const viewport = svg.querySelector('#viewport') as SVGGElement;
  return viewport.getBBox();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
