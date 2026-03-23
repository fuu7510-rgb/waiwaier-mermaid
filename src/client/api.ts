import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

export async function fetchDiagram(): Promise<ERDiagramJSON> {
  const res = await fetch('/api/diagram', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch diagram: ${res.statusText}`);
  return res.json();
}

export async function fetchLayout(): Promise<LayoutData> {
  const res = await fetch('/api/layout', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch layout: ${res.statusText}`);
  return res.json();
}

export async function saveLayout(layout: LayoutData): Promise<void> {
  const res = await fetch('/api/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
  if (!res.ok) throw new Error(`Failed to save layout: ${res.statusText}`);
}
