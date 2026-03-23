import { describe, it, expect } from 'vitest';
import { layoutDataSchema } from '../server/layout-schema.js';

const validLayout = {
  version: 1,
  diagramFile: 'test.mmd',
  contentHash: 'sha256:abc123',
  canvas: { panX: 0, panY: 0, zoom: 1.0 },
  entities: { USERS: { x: 100, y: 200 } },
};

describe('layoutDataSchema', () => {
  it('正常なレイアウトデータを受け入れる', () => {
    const result = layoutDataSchema.safeParse(validLayout);
    expect(result.success).toBe(true);
  });

  it('オプショナルフィールド付きデータを受け入れる', () => {
    const data = {
      ...validLayout,
      labels: { USERS: 'ユーザー' },
      compactEntities: { USERS: { x: 50, y: 50 } },
      compactCanvas: { panX: 10, panY: 10, zoom: 0.5 },
    };
    const result = layoutDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('_schemaメタデータ付きデータを受け入れる（stripで除去）', () => {
    const data = {
      _schema: { description: 'metadata' },
      ...validLayout,
    };
    const result = layoutDataSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any)._schema).toBeUndefined();
    }
  });

  it('versionが欠落したデータを拒否する', () => {
    const { version, ...noVersion } = validLayout;
    const result = layoutDataSchema.safeParse(noVersion);
    expect(result.success).toBe(false);
  });

  it('entitiesの座標が数値でないデータを拒否する', () => {
    const data = {
      ...validLayout,
      entities: { USERS: { x: 'not a number', y: 200 } },
    };
    const result = layoutDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('canvasのフィールドが欠落したデータを拒否する', () => {
    const data = { ...validLayout, canvas: { panX: 0 } };
    const result = layoutDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
