// src/client/export.ts
import { showToast } from './toast.js';

const MAX_CANVAS_SIZE = 4096;

/** Remove display:none set by viewport culling so all elements are exported */
function removeCullingDisplay(clone: SVGSVGElement): void {
  clone.querySelectorAll('[display="none"]').forEach(el => el.removeAttribute('display'));
}

export function exportSVG(svgElement: SVGSVGElement, filename: string): void {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  const viewport = clone.querySelector('#viewport') as SVGGElement;

  // Remove viewport transform to get raw coordinates
  viewport.removeAttribute('transform');

  // Ensure culled elements are visible in export
  removeCullingDisplay(clone);

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

export async function exportPNG(svgElement: SVGSVGElement, filename: string): Promise<void> {
  const blob = await svgToPngBlob(svgElement);
  downloadBlob(blob, filename);
}

export async function copyToClipboard(svgElement: SVGSVGElement): Promise<void> {
  const blob = await svgToPngBlob(svgElement);
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
  showToast('クリップボードにコピーしました');
}

async function svgToPngBlob(svgElement: SVGSVGElement): Promise<Blob> {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  const viewport = clone.querySelector('#viewport') as SVGGElement;
  viewport.removeAttribute('transform');
  removeCullingDisplay(clone);
  inlineStyles(clone);

  const bbox = calculateBBox(svgElement);
  const padding = 20;
  const w = bbox.width + padding * 2;
  const h = bbox.height + padding * 2;

  clone.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${w} ${h}`);
  clone.removeAttribute('id');

  let scale = 2;  // Retina 2x
  if (w * scale > MAX_CANVAS_SIZE || h * scale > MAX_CANVAS_SIZE) {
    scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h);
  }

  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
}
