import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import type { LayoutData } from '../parser/types.js';

export class LayoutStore {
  private layoutPath: string;
  private diagramPath: string;

  constructor(diagramPath: string) {
    this.diagramPath = diagramPath;
    this.layoutPath = diagramPath + '.layout.json';
  }

  getLayoutPath(): string {
    return this.layoutPath;
  }

  computeHash(content: string): string {
    return 'sha256:' + createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  load(): LayoutData | null {
    if (!existsSync(this.layoutPath)) return null;
    try {
      const raw = readFileSync(this.layoutPath, 'utf-8');
      return JSON.parse(raw) as LayoutData;
    } catch {
      return null;
    }
  }

  save(layout: LayoutData): void {
    writeFileSync(this.layoutPath, JSON.stringify(layout, null, 2), 'utf-8');
  }

  createDefault(diagramContent: string): LayoutData {
    const filename = this.diagramPath.replace(/\\/g, '/').split('/').pop() || '';
    return {
      version: 1,
      diagramFile: filename,
      contentHash: this.computeHash(diagramContent),
      canvas: { panX: 0, panY: 0, zoom: 1.0 },
      entities: {},
    };
  }
}
