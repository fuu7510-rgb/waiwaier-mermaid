import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LayoutStore } from '../server/layout-store.js';

let tempDir: string;
let store: LayoutStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'layout-store-test-'));
  store = new LayoutStore(join(tempDir, 'test.mmd'));
});

afterEach(() => {
  const layoutPath = store.getLayoutPath();
  if (existsSync(layoutPath)) {
    rmSync(layoutPath);
  }
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// computeHash
// ---------------------------------------------------------------------------
describe('computeHash', () => {
  it('同じ入力に対して同じハッシュを返す', () => {
    const h1 = store.computeHash('hello world');
    const h2 = store.computeHash('hello world');
    expect(h1).toBe(h2);
  });

  it('異なる入力に対して異なるハッシュを返す', () => {
    const h1 = store.computeHash('hello world');
    const h2 = store.computeHash('goodbye world');
    expect(h1).not.toBe(h2);
  });

  it('sha256: プレフィックスで始まり16桁hexの形式', () => {
    const hash = store.computeHash('test content');
    expect(hash).toMatch(/^sha256:[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------
describe('load', () => {
  it('ファイルが存在しない場合nullを返す', () => {
    const result = store.load();
    expect(result).toBeNull();
  });

  it('save後にloadで同じデータを取得できる', () => {
    const layout = store.createDefault('erDiagram\n  USER {\n    int id PK\n  }\n');
    store.save(layout);

    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(layout.version);
    expect(loaded!.diagramFile).toBe(layout.diagramFile);
    expect(loaded!.contentHash).toBe(layout.contentHash);
    expect(loaded!.canvas).toEqual(layout.canvas);
    expect(loaded!.entities).toEqual(layout.entities);
  });
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------
describe('save', () => {
  it('_schemaメタデータを付与して保存する', () => {
    const layout = store.createDefault('erDiagram');
    store.save(layout);

    const layoutPath = store.getLayoutPath();
    const raw = readFileSync(layoutPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveProperty('_schema');
    expect(parsed._schema).toHaveProperty('description');
    expect(parsed._schema.description).toBe('Mermaid ER Viewer layout file');
    expect(parsed._schema).toHaveProperty('fields');
  });
});

// ---------------------------------------------------------------------------
// createDefault
// ---------------------------------------------------------------------------
describe('createDefault', () => {
  it('デフォルトレイアウトを生成する (version=1, canvas={panX:0,panY:0,zoom:1.0}, entities={})', () => {
    const layout = store.createDefault('erDiagram');
    expect(layout.version).toBe(1);
    expect(layout.canvas).toEqual({ panX: 0, panY: 0, zoom: 1.0 });
    expect(layout.entities).toEqual({});
  });

  it('contentHashを計算する', () => {
    const content = 'erDiagram\n  USER {\n    int id PK\n  }\n';
    const layout = store.createDefault(content);
    expect(layout.contentHash).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(layout.contentHash).toBe(store.computeHash(content));
  });
});

// ---------------------------------------------------------------------------
// getLayoutPath
// ---------------------------------------------------------------------------
describe('getLayoutPath', () => {
  it('.mmd.layout.json のパスを返す', () => {
    const layoutPath = store.getLayoutPath();
    expect(layoutPath).toBe(join(tempDir, 'test.mmd') + '.layout.json');
  });
});
