import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import type { LayoutData } from '../parser/types.js';

export class LayoutStore {
  private layoutPath: string;
  private diagramPath: string;

  private static readonly SCHEMA_META = {
    description: 'Mermaid ER Viewer layout file',
    fields: {
      version: 'number — schema version (currently 1)',
      diagramFile: 'string — source .mmd filename',
      contentHash: 'string — hash of diagram content for change detection',
      canvas: '{ panX, panY, zoom } — viewport state for normal mode',
      entities: 'Record<entityName, { x, y }> — entity positions for normal mode',
      compactEntities: 'Record<entityName, { x, y }> — entity positions for compact mode',
      compactCanvas: '{ panX, panY, zoom } — viewport state for compact mode',
    },
    notes: {
      entityLabels: 'エンティティの日本語名は .mmd ファイル内で Mermaid標準の ENTITY["ラベル"] 構文を使用してください',
      relationshipLabels: 'リレーションのラベル（日本語名など）は .mmd ファイル内に直接記述してください。例: USERS ||--o{ ORDERS : "注文する"',
    },
  };

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

  private buildOutput(layout: LayoutData): object {
    return { _schema: LayoutStore.SCHEMA_META, ...layout };
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

  private atomicWrite(content: string): void {
    const tmpPath = this.layoutPath + '.tmp';
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, this.layoutPath);
  }

  save(layout: LayoutData): void {
    this.atomicWrite(JSON.stringify(this.buildOutput(layout), null, 2));
  }

  saveAndGetHash(layout: LayoutData): string {
    const content = JSON.stringify(this.buildOutput(layout), null, 2);
    this.atomicWrite(content);
    return this.computeHash(content);
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
