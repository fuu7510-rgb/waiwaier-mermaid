# Code Review Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コードレビュー全指摘事項を3フェーズで段階的に改善し、テスト・セキュリティ・新機能・差別化機能を追加する。

**Architecture:** Phase 1で基盤強化（vitest, セキュリティ, バリデーション, リファクタ）、Phase 2で機能追加（エクスポート, 検索, テーマ, タッチ）、Phase 3で差別化（ミニマップ, グループ化, auto-layout MCP）。各フェーズ完了時点でリリース可能。

**Tech Stack:** TypeScript, vitest, zod v4, Express, esbuild, SVG, Canvas API

**Spec:** `docs/superpowers/specs/2026-03-23-code-review-improvements-design.md`

---

## File Structure

### Phase 1 — 新規ファイル
| ファイル | 責務 |
|---------|------|
| `vitest.config.ts` | vitest設定 |
| `src/__tests__/er-parser.test.ts` | パーサーユニットテスト |
| `src/__tests__/layout-store.test.ts` | LayoutStoreテスト |
| `src/__tests__/cardinality.test.ts` | カーディナリティテスト |
| `src/__tests__/path-traversal.test.ts` | assertWithinBaseユニットテスト |
| `src/__tests__/layout-schema.test.ts` | zodスキーマテスト |
| `src/__tests__/api-security.test.ts` | パストラバーサル統合テスト |
| `src/server/layout-schema.ts` | LayoutData zodスキーマ |
| `src/server/path-guard.ts` | assertWithinBaseヘルパー |
| `src/client/pan-zoom.ts` | パン/ズーム制御モジュール |
| `src/client/highlight.ts` | ハイライトロジックモジュール |
| `src/client/label-editor.ts` | ラベル編集UIモジュール |

### Phase 2 — 新規ファイル
| ファイル | 責務 |
|---------|------|
| `src/client/toast.ts` | トースト通知ユーティリティ（export.ts等から利用） |
| `src/client/export.ts` | SVG/PNG/クリップボードエクスポート |
| `src/client/search.ts` | 検索/フィルタ機能 |

### Phase 3 — 新規ファイル
| ファイル | 責務 |
|---------|------|
| `src/client/minimap.ts` | ミニマップ表示 |
| `src/shared/auto-layout.ts` | 共有レイアウト計算（ERDiagramJSON型ベース） |

---

## Phase 1: 基盤強化

### Task 1: vitest導入

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: vitestとsupertestをインストール**

```bash
npm install -D vitest supertest @types/supertest
```

- [ ] **Step 2: vitest.config.tsを作成**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: package.jsonにtestスクリプト追加**

`package.json` の `"scripts"` に追加:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: テストが実行できることを確認**

```bash
npx vitest run
```
Expected: `No test files found` (テストファイルがまだないため)

- [ ] **Step 5: コミット**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: vitest・supertest導入"
```

---

### Task 2: パーサーユニットテスト

**Files:**
- Create: `src/__tests__/er-parser.test.ts`
- Reference: `src/parser/er-parser.ts` (全体)、`src/parser/types.ts` (型定義)

- [ ] **Step 1: 正常系テストを作成**

```typescript
// src/__tests__/er-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseERDiagram } from '../parser/er-parser.js';

describe('parseERDiagram', () => {
  describe('erDiagram宣言', () => {
    it('erDiagramキーワードで始まるテキストをパースできる', () => {
      const result = parseERDiagram('erDiagram\n  USERS {\n    int id PK\n  }');
      expect(result.entities.size).toBe(1);
      expect(result.entities.get('USERS')).toBeDefined();
    });

    it('erDiagramキーワードがない場合は空の結果を返す', () => {
      const result = parseERDiagram('USERS {\n  int id PK\n}');
      expect(result.entities.size).toBe(0);
    });

    it('erDiagram後にタイトルテキストがある行は無視する', () => {
      // ER_DIAGRAM_RE は /^\s*erDiagram\s*$/ なので "erDiagram Title" はマッチしない
      const result = parseERDiagram('erDiagram My Title\n  USERS {\n    int id PK\n  }');
      expect(result.entities.size).toBe(0);
    });
  });

  describe('エンティティ', () => {
    it('属性付きエンティティをパースできる', () => {
      const input = `erDiagram
  USERS {
    int id PK
    varchar name
    varchar email UK
  }`;
      const result = parseERDiagram(input);
      const users = result.entities.get('USERS')!;
      expect(users.name).toBe('USERS');
      expect(users.attributes).toHaveLength(3);
      expect(users.attributes[0]).toEqual({
        type: 'int', name: 'id', keys: ['PK'], comment: '',
      });
      expect(users.attributes[2].keys).toContain('UK');
    });

    it('ラベル付きエンティティ ["..."] をパースできる', () => {
      const input = 'erDiagram\n  USERS["ユーザー"] {\n    int id PK\n  }';
      const result = parseERDiagram(input);
      const users = result.entities.get('USERS')!;
      expect(users.label).toBe('ユーザー');
    });

    it('ラベルなしの場合はlabelが空文字', () => {
      const input = 'erDiagram\n  USERS {\n    int id PK\n  }';
      const result = parseERDiagram(input);
      expect(result.entities.get('USERS')!.label).toBe('');
    });

    it('コメント付き属性をパースできる', () => {
      const input = 'erDiagram\n  USERS {\n    int id PK "主キー"\n  }';
      const result = parseERDiagram(input);
      expect(result.entities.get('USERS')!.attributes[0].comment).toBe('主キー');
    });

    it('複合キー PK,FK をパースできる', () => {
      const input = 'erDiagram\n  ORDER_ITEMS {\n    int order_id PK,FK\n  }';
      const result = parseERDiagram(input);
      const attr = result.entities.get('ORDER_ITEMS')!.attributes[0];
      expect(attr.keys).toEqual(['PK', 'FK']);
    });
  });

  describe('リレーションシップ', () => {
    it('基本的なリレーションをパースできる', () => {
      const input = 'erDiagram\n  USERS ||--o{ ORDERS : "places"';
      const result = parseERDiagram(input);
      expect(result.relationships).toHaveLength(1);
      const rel = result.relationships[0];
      expect(rel.entityA).toBe('USERS');
      expect(rel.entityB).toBe('ORDERS');
      expect(rel.label).toBe('places');
      expect(rel.identifying).toBe(true);
    });

    it('非識別リレーション (..) をパースできる', () => {
      const input = 'erDiagram\n  USERS ||..o{ ORDERS : "places"';
      const result = parseERDiagram(input);
      expect(result.relationships[0].identifying).toBe(false);
    });

    it('各種カーディナリティ記号を正しくパースする', () => {
      const input = 'erDiagram\n  A }o--|| B : "test"';
      const result = parseERDiagram(input);
      const rel = result.relationships[0];
      expect(rel.cardinalityA).toEqual({ min: 'zero', max: 'many' });
      expect(rel.cardinalityB).toEqual({ min: 'one', max: 'one' });
    });

    it('ラベルなしリレーションをパースできる', () => {
      const input = 'erDiagram\n  USERS ||--o{ ORDERS : ""';
      const result = parseERDiagram(input);
      expect(result.relationships[0].label).toBe('');
    });
  });

  describe('エッジケース', () => {
    it('空行を無視する', () => {
      const input = 'erDiagram\n\n  USERS {\n    int id PK\n  }\n\n';
      const result = parseERDiagram(input);
      expect(result.entities.size).toBe(1);
    });

    it('コメント行 (%%) を無視する', () => {
      const input = 'erDiagram\n  %% これはコメント\n  USERS {\n    int id PK\n  }';
      const result = parseERDiagram(input);
      expect(result.entities.size).toBe(1);
    });

    it('不正な行を無視する', () => {
      const input = 'erDiagram\n  this is not valid\n  USERS {\n    int id PK\n  }';
      const result = parseERDiagram(input);
      expect(result.entities.size).toBe(1);
    });

    it('空の入力で空の結果を返す', () => {
      const result = parseERDiagram('');
      expect(result.entities.size).toBe(0);
      expect(result.relationships).toHaveLength(0);
    });

    it.todo('パラメータ付き型 varchar(255) は現在未対応 — ATTRIBUTE_REが\\w+のみ対応', () => {
      const input = 'erDiagram\n  USERS {\n    varchar(255) name\n  }';
      const result = parseERDiagram(input);
      expect(result.entities.get('USERS')!.attributes).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: テストを実行して全パスを確認**

```bash
npx vitest run src/__tests__/er-parser.test.ts
```
Expected: PASS（todoテスト以外）

- [ ] **Step 3: コミット**

```bash
git add src/__tests__/er-parser.test.ts
git commit -m "test: パーサーユニットテスト追加"
```

---

### Task 3: LayoutStoreテスト

**Files:**
- Create: `src/__tests__/layout-store.test.ts`
- Reference: `src/server/layout-store.ts`

- [ ] **Step 1: テストを作成**

```typescript
// src/__tests__/layout-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LayoutStore } from '../server/layout-store.js';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('LayoutStore', () => {
  let tempDir: string;
  let store: LayoutStore;
  const mmdPath = () => join(tempDir, 'test.mmd');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'layout-store-test-'));
    store = new LayoutStore(mmdPath());
  });

  afterEach(() => {
    const layoutPath = mmdPath() + '.layout.json';
    if (existsSync(layoutPath)) unlinkSync(layoutPath);
    rmdirSync(tempDir);
  });

  describe('computeHash', () => {
    it('同じ入力に対して同じハッシュを返す', () => {
      const h1 = store.computeHash('hello');
      const h2 = store.computeHash('hello');
      expect(h1).toBe(h2);
    });

    it('異なる入力に対して異なるハッシュを返す', () => {
      const h1 = store.computeHash('hello');
      const h2 = store.computeHash('world');
      expect(h1).not.toBe(h2);
    });

    it('sha256:プレフィックスで始まる', () => {
      expect(store.computeHash('test')).toMatch(/^sha256:[0-9a-f]{16}$/);
    });
  });

  describe('load', () => {
    it('ファイルが存在しない場合nullを返す', () => {
      expect(store.load()).toBeNull();
    });

    it('save後にloadで同じデータを取得できる', () => {
      const layout = store.createDefault('erDiagram');
      store.save(layout);
      const loaded = store.load()!;
      expect(loaded.version).toBe(layout.version);
      expect(loaded.contentHash).toBe(layout.contentHash);
      expect(loaded.entities).toEqual(layout.entities);
    });
  });

  describe('save', () => {
    it('_schemaメタデータを付与して保存する', () => {
      const layout = store.createDefault('erDiagram');
      store.save(layout);
      const loaded = store.load() as any;
      expect(loaded._schema).toBeDefined();
      expect(loaded._schema.description).toBe('Mermaid ER Viewer layout file');
    });
  });

  describe('createDefault', () => {
    it('デフォルトレイアウトを生成する', () => {
      const layout = store.createDefault('erDiagram');
      expect(layout.version).toBe(1);
      expect(layout.canvas).toEqual({ panX: 0, panY: 0, zoom: 1.0 });
      expect(layout.entities).toEqual({});
    });

    it('contentHashを計算する', () => {
      const layout = store.createDefault('erDiagram');
      expect(layout.contentHash).toMatch(/^sha256:/);
    });
  });

  describe('getLayoutPath', () => {
    it('.mmd.layout.jsonのパスを返す', () => {
      expect(store.getLayoutPath()).toBe(mmdPath() + '.layout.json');
    });
  });
});
```

- [ ] **Step 2: テスト実行**

```bash
npx vitest run src/__tests__/layout-store.test.ts
```
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/__tests__/layout-store.test.ts
git commit -m "test: LayoutStoreユニットテスト追加"
```

---

### Task 4: カーディナリティテスト

**Files:**
- Create: `src/__tests__/cardinality.test.ts`
- Reference: `src/parser/er-parser.ts:22-40` (parseCardinality関数)

**注:** このテストは `parseCardinality`（パーサー内のカーディナリティ解析関数）を対象とする。クライアント側の `src/client/cardinality.ts`（SVG描画）は別モジュールでありここではテストしない。

- [ ] **Step 1: er-parser.tsからparseCardinalityをexport**

`src/parser/er-parser.ts` の `function parseCardinality` に `export` キーワードを追加する（テストでimportするため）。

- [ ] **Step 2: テストを作成**

```typescript
// src/__tests__/cardinality.test.ts
import { describe, it, expect } from 'vitest';
import { parseCardinality } from '../parser/er-parser.js';

describe('parseCardinality', () => {
  it('|| → one-to-one (min:one, max:one)', () => {
    expect(parseCardinality('||')).toEqual({ min: 'one', max: 'one' });
  });

  it('o| → zero-to-one (min:zero, max:one)', () => {
    expect(parseCardinality('o|')).toEqual({ min: 'zero', max: 'one' });
  });

  it('|{ → one-to-many (min:one, max:many)', () => {
    expect(parseCardinality('|{')).toEqual({ min: 'one', max: 'many' });
  });

  it('o{ → zero-to-many (min:zero, max:many)', () => {
    expect(parseCardinality('o{')).toEqual({ min: 'zero', max: 'many' });
  });

  it('}| → one-to-many (右側)', () => {
    expect(parseCardinality('}|')).toEqual({ min: 'one', max: 'many' });
  });

  it('}o → zero-to-many (右側)', () => {
    expect(parseCardinality('}o')).toEqual({ min: 'zero', max: 'many' });
  });
});
```

- [ ] **Step 3: テスト実行**

```bash
npx vitest run src/__tests__/cardinality.test.ts
```
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/__tests__/cardinality.test.ts src/parser/er-parser.ts
git commit -m "test: カーディナリティ解析テスト追加"
```

---

### Task 5: パストラバーサル防止

**Files:**
- Create: `src/server/path-guard.ts`
- Create: `src/__tests__/path-traversal.test.ts`
- Modify: `src/server/server.ts:100-198` (browse, open エンドポイント)

- [ ] **Step 1: テストを先に作成**

```typescript
// src/__tests__/path-traversal.test.ts
import { describe, it, expect } from 'vitest';
import { assertWithinBase } from '../server/path-guard.js';

describe('assertWithinBase', () => {
  const baseDir = process.platform === 'win32'
    ? 'C:\\workspace\\project'
    : '/workspace/project';

  it('baseDir配下のパスを許可する', () => {
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\project\\src\\file.ts'
      : '/workspace/project/src/file.ts';
    expect(() => assertWithinBase(target, baseDir)).not.toThrow();
  });

  it('baseDir自体を許可する', () => {
    expect(() => assertWithinBase(baseDir, baseDir)).not.toThrow();
  });

  it('baseDir外のパスを拒否する', () => {
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\other'
      : '/workspace/other';
    expect(() => assertWithinBase(target, baseDir)).toThrow('Path traversal detected');
  });

  it('../による脱出を拒否する', () => {
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\project\\..\\other'
      : '/workspace/project/../other';
    expect(() => assertWithinBase(target, baseDir)).toThrow('Path traversal detected');
  });

  it('baseDirのプレフィックスだけ一致するパスを拒否する', () => {
    // "project-evil" は "project" のプレフィックスだがサブディレクトリではない
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\project-evil\\file.ts'
      : '/workspace/project-evil/file.ts';
    expect(() => assertWithinBase(target, baseDir)).toThrow('Path traversal detected');
  });
});
```

- [ ] **Step 2: テスト実行して失敗を確認**

```bash
npx vitest run src/__tests__/path-traversal.test.ts
```
Expected: FAIL (path-guard.ts が存在しない)

- [ ] **Step 3: path-guard.tsを実装**

```typescript
// src/server/path-guard.ts
import { resolve, sep } from 'path';

export function assertWithinBase(targetPath: string, baseDir: string): void {
  let resolved = resolve(targetPath);
  let base = resolve(baseDir);
  if (process.platform === 'win32') {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1);
    base = base.charAt(0).toUpperCase() + base.slice(1);
  }
  if (!resolved.startsWith(base + sep) && resolved !== base) {
    throw new Error('Path traversal detected');
  }
}
```

- [ ] **Step 4: テスト実行してパスを確認**

```bash
npx vitest run src/__tests__/path-traversal.test.ts
```
Expected: PASS

- [ ] **Step 5: server.tsの /api/browse にガードを適用**

`src/server/server.ts` の先頭にimport追加:
```typescript
import { assertWithinBase } from './path-guard.js';
```

`GET /api/browse` ハンドラ（~行103）で `resolve()` 直後にガードを追加:
```typescript
const targetPath = req.query.path ? resolve(String(req.query.path)) : baseDir;
try {
  assertWithinBase(targetPath, baseDir);
} catch {
  res.status(403).json({ error: 'Access denied: path outside base directory' });
  return;
}
```

- [ ] **Step 6: server.tsの /api/open にガードを適用**

`POST /api/open` ハンドラ（~行161）で同様にガードを追加:
```typescript
const filePath = resolve(String(req.body.file));
try {
  assertWithinBase(filePath, baseDir);
} catch {
  res.status(403).json({ error: 'Access denied: path outside base directory' });
  return;
}
```

- [ ] **Step 7: ビルド確認**

```bash
npm run build
```
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add src/server/path-guard.ts src/__tests__/path-traversal.test.ts src/server/server.ts
git commit -m "security: パストラバーサル防止ガード追加"
```

---

### Task 6: API統合テスト（パストラバーサル検証）

**Files:**
- Create: `src/__tests__/api-security.test.ts`
- Modify: `src/server/server.ts` (Expressアプリをexport)

- [ ] **Step 1: server.tsをリファクタしてExpressアプリをテスト可能にする**

現在の `startServer()` はExpressアプリの作成、ルート登録、WebSocket設定、HTTP listen が1関数に集約されている。テスト用にHTTPルートだけを持つExpressアプリを生成する `createApp()` を抽出する。

**具体的な手順:**

1. `createApp(baseDir: string, state: ServerState)` 関数を新規作成
2. `startServer()` 内の以下のコードを `createApp()` に移動:
   - `express()` 呼び出しとミドルウェア設定（`express.json()`, `express.static()`）
   - 全ルート登録（`GET /api/diagram`, `GET /api/layout`, `PUT /api/layout`, `GET /api/browse`, `POST /api/open` 等）
3. `startServer()` では `createApp()` を呼んでアプリを受け取り、HTTP server作成とWebSocket設定を行う

```typescript
// server.ts

// テストでもサーバーでも使えるExpressアプリを生成
export function createApp(baseDir: string, state?: Partial<ServerState>) {
  const app = express();
  app.use(express.json());

  // state が渡されない場合はテスト用のミニマル状態を作成
  const s: ServerState = {
    mmdPath: state?.mmdPath || '',
    layoutStore: state?.layoutStore || null as any,
    lastWrittenHash: state?.lastWrittenHash || null,
    // ... テストに必要なフィールド
    ...state,
  } as ServerState;

  // --- 静的ファイル ---
  app.use(express.static(/* client dir */));

  // --- GET /api/browse ---
  app.get('/api/browse', (req, res) => {
    const targetPath = req.query.path ? resolve(String(req.query.path)) : baseDir;
    try { assertWithinBase(targetPath, baseDir); }
    catch { res.status(403).json({ error: 'Access denied' }); return; }
    // ... 既存のディレクトリ読み取りロジック
  });

  // --- POST /api/open ---
  // --- GET /api/diagram ---
  // --- GET /api/layout ---
  // --- PUT /api/layout ---
  // (既存のルートハンドラをそのまま移動)

  return app;
}

export async function startServer(options: ServerOptions) {
  const state: ServerState = { /* ... */ };
  const app = createApp(options.baseDir, state);
  const httpServer = createServer(app);
  // WebSocket設定, listen, file watcher 等は startServer に残す
  // ...
}
```

**ポイント:**
- `/api/browse` と `/api/open` はstate不要（baseDirとファイルシステムのみ依存）なのでテスト可能
- `/api/diagram`, `/api/layout`, `PUT /api/layout` はstateに依存するが、テストではモック可能
- WebSocket (`broadcast()`, `wss`) は `startServer()` に残す。ルートハンドラ内で `broadcast()` を使う箇所はコールバック経由で注入する

- [ ] **Step 2: テスト作成**

```typescript
// src/__tests__/api-security.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/server.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('API Security', () => {
  let app: any;
  let baseDir: string;

  beforeAll(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'api-security-test-'));
    writeFileSync(join(baseDir, 'test.mmd'), 'erDiagram\n');
    app = createApp(baseDir);
  });

  afterAll(() => {
    const { rmSync } = require('fs');
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('GET /api/browse', () => {
    it('baseDir内のパスを許可する', async () => {
      const res = await request(app).get('/api/browse');
      expect(res.status).toBe(200);
    });

    it('baseDir外のパスを403で拒否する', async () => {
      const res = await request(app).get('/api/browse?path=/etc');
      expect(res.status).toBe(403);
    });

    it('../による脱出を403で拒否する', async () => {
      const res = await request(app)
        .get(`/api/browse?path=${encodeURIComponent(join(baseDir, '..'))}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/open', () => {
    it('baseDir外のファイルを403で拒否する', async () => {
      const res = await request(app)
        .post('/api/open')
        .send({ file: '/etc/passwd.mmd' });
      expect(res.status).toBe(403);
    });
  });
});
```

- [ ] **Step 3: テスト実行**

```bash
npx vitest run src/__tests__/api-security.test.ts
```
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/__tests__/api-security.test.ts src/server/server.ts
git commit -m "test: パストラバーサル防止の統合テスト追加"
```

---

### Task 7: zodバリデーションスキーマ

**Files:**
- Create: `src/server/layout-schema.ts`
- Create: `src/__tests__/layout-schema.test.ts`
- Modify: `src/server/server.ts:264-283` (PUT /api/layout)

- [ ] **Step 1: テストを先に作成**

```typescript
// src/__tests__/layout-schema.test.ts
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
```

- [ ] **Step 2: テスト実行して失敗を確認**

```bash
npx vitest run src/__tests__/layout-schema.test.ts
```
Expected: FAIL (layout-schema.ts が存在しない)

- [ ] **Step 3: layout-schema.tsを実装**

```typescript
// src/server/layout-schema.ts
import { z } from 'zod';

const canvasSchema = z.object({
  panX: z.number(),
  panY: z.number(),
  zoom: z.number(),
});

const entityPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const layoutDataSchema = z.object({
  version: z.number(),
  diagramFile: z.string(),
  contentHash: z.string(),
  canvas: canvasSchema,
  entities: z.record(entityPositionSchema),
  labels: z.record(z.string()).optional(),
  compactEntities: z.record(entityPositionSchema).optional(),
  compactCanvas: canvasSchema.optional(),
}).strip();
```

- [ ] **Step 4: テスト実行してパスを確認**

```bash
npx vitest run src/__tests__/layout-schema.test.ts
```
Expected: PASS

- [ ] **Step 5: server.tsのPUT /api/layoutにバリデーション適用**

`src/server/server.ts` のPUTハンドラ（~行264-283）を修正:

```typescript
import { layoutDataSchema } from './layout-schema.js';

// PUT /api/layout ハンドラ内
const parsed = layoutDataSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: 'Invalid layout data', details: parsed.error.issues });
  return;
}
const layout = parsed.data as LayoutData;
```

- [ ] **Step 6: ビルド確認**

```bash
npm run build
```
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/server/layout-schema.ts src/__tests__/layout-schema.test.ts src/server/server.ts
git commit -m "feat: PUT /api/layout にzodバリデーション追加"
```

---

### Task 8: layoutSaving競合制御の改善

**Files:**
- Modify: `src/server/layout-store.ts` (saveAndGetHash追加)
- Modify: `src/server/server.ts` (layoutSaving → lastWrittenHash)
- Modify: `src/__tests__/layout-store.test.ts` (saveAndGetHash テスト追加)

- [ ] **Step 1: layout-store.test.tsにsaveAndGetHashテスト追加**

```typescript
// src/__tests__/layout-store.test.ts に追加
describe('saveAndGetHash', () => {
  it('保存した内容のハッシュを返す', () => {
    const layout = store.createDefault('erDiagram');
    const hash = store.saveAndGetHash(layout);
    expect(hash).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it('同じデータで2回呼ぶと同じハッシュを返す', () => {
    const layout = store.createDefault('erDiagram');
    const h1 = store.saveAndGetHash(layout);
    const h2 = store.saveAndGetHash(layout);
    expect(h1).toBe(h2);
  });

  it('返されたハッシュはディスク上のファイル内容と一致する', () => {
    const layout = store.createDefault('erDiagram');
    const hash = store.saveAndGetHash(layout);
    const content = readFileSync(store.getLayoutPath(), 'utf-8');
    expect(store.computeHash(content)).toBe(hash);
  });
});
```

`import` に `readFileSync` を追加。

- [ ] **Step 2: テスト実行して失敗を確認**

```bash
npx vitest run src/__tests__/layout-store.test.ts
```
Expected: FAIL (saveAndGetHash が存在しない)

- [ ] **Step 3: layout-store.tsの_schemaを定数に抽出し、saveAndGetHashを実装**

まず `save()` と共有するために `_schema` オブジェクトを `private` 定数に抽出する:

```typescript
// src/server/layout-store.ts のクラス先頭に追加
private static readonly SCHEMA_META = {
  description: 'Mermaid ER Viewer layout file',
  fields: {
    version: 'number — schema version (currently 1)',
    diagramFile: 'string — source .mmd filename',
    contentHash: 'string — hash of diagram content for change detection',
    canvas: '{ panX, panY, zoom } — viewport state for normal mode',
    entities: 'Record<entityName, { x, y }> — entity positions for normal mode',
    labels: 'Record<entityName, string> — display labels (e.g. Japanese names) shown below entity name',
    compactEntities: 'Record<entityName, { x, y }> — entity positions for compact mode',
    compactCanvas: '{ panX, panY, zoom } — viewport state for compact mode',
  },
  notes: {
    relationshipLabels: 'リレーションのラベル（日本語名など）は .mmd ファイル内に直接記述してください。例: USERS ||--o{ ORDERS : "注文する"',
  },
  labels_example: {
    users: 'ユーザー',
    orders: '注文',
    order_items: '注文明細',
  },
};
```

次に `save()` を `SCHEMA_META` を使うよう変更し、`saveAndGetHash()` を追加:

```typescript
private buildOutput(layout: LayoutData) {
  return { _schema: LayoutStore.SCHEMA_META, ...layout };
}

save(layout: LayoutData): void {
  writeFileSync(this.layoutPath, JSON.stringify(this.buildOutput(layout), null, 2), 'utf-8');
}

saveAndGetHash(layout: LayoutData): string {
  const content = JSON.stringify(this.buildOutput(layout), null, 2);
  writeFileSync(this.layoutPath, content, 'utf-8');
  return this.computeHash(content);
}
```

- [ ] **Step 4: テスト実行してパスを確認**

```bash
npx vitest run src/__tests__/layout-store.test.ts
```
Expected: PASS

- [ ] **Step 5: server.tsのlayoutSavingロジックを置換**

`src/server/server.ts` で以下を変更:

1. `ServerState` インターフェース（~行21-27）から `layoutSaving: boolean` を削除し、`lastWrittenHash: string | null` に変更
2. 初期化（~行40）で `layoutSaving: false` → `lastWrittenHash: null`
3. PUT /api/layout ハンドラ（~行272-275）を変更:
   ```typescript
   // Before:
   state.layoutSaving = true;
   state.layoutStore.save(layout);
   setTimeout(() => { state.layoutSaving = false; }, 500);

   // After:
   state.lastWrittenHash = state.layoutStore.saveAndGetHash(layout);
   ```
4. ファイル監視コールバック（layout.json変更時、`startLayoutWatcher` 内）を変更:
   ```typescript
   // Before:
   if (state.layoutSaving) return;

   // After:
   // LayoutStore.computeHash() を再利用（cryptoの直接importは不要）
   const content = readFileSync(state.layoutStore.getLayoutPath(), 'utf-8');
   const currentHash = state.layoutStore.computeHash(content);
   if (currentHash === state.lastWrittenHash) {
     state.lastWrittenHash = null;
     return; // 自分が書いた変更 → 無視
   }
   ```

- [ ] **Step 6: ビルド確認**

```bash
npm run build
```
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/server/layout-store.ts src/server/server.ts src/__tests__/layout-store.test.ts
git commit -m "fix: layoutSaving競合制御をハッシュ比較方式に改善"
```

---

### Task 9: main.ts分割 — pan-zoom.ts

**Files:**
- Create: `src/client/pan-zoom.ts`
- Modify: `src/client/main.ts`

- [ ] **Step 1: pan-zoom.tsを作成**

`src/client/main.ts` から以下を抽出（**行番号は分割前のオリジナル基準。以降のTaskで行番号がずれるため、関数名で特定すること**）:
- パン/ズーム状態変数: `panX`, `panY`, `zoom`, `isPanning`, `panStartX/Y`, `panStartPanX/Y`, `MIN_ZOOM`, `MAX_ZOOM`
- `setupPanZoom()` 関数全体

```typescript
// src/client/pan-zoom.ts

export interface PanZoomState {
  panX: number;
  panY: number;
  zoom: number;
  isPanning: boolean;
  panStartX: number;
  panStartY: number;
  panStartPanX: number;
  panStartPanY: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

export function createPanZoomState(): PanZoomState {
  return {
    panX: 0, panY: 0, zoom: 1,
    isPanning: false,
    panStartX: 0, panStartY: 0,
    panStartPanX: 0, panStartPanY: 0,
  };
}

export interface PanZoomDeps {
  svg: SVGSVGElement;
  onTransformChange: () => void;
}

export function setupPanZoom(state: PanZoomState, deps: PanZoomDeps): void {
  // main.ts の setupPanZoom() 関数のロジックをここに移動
  // state.panX, state.zoom 等を直接読み書きする
  // deps.onTransformChange() でビューポート更新をトリガー
}
```

- [ ] **Step 2: main.tsから該当コードを削除し、pan-zoom.tsをimport**

```typescript
// main.ts 先頭にimport追加
import { createPanZoomState, setupPanZoom, MIN_ZOOM, MAX_ZOOM, type PanZoomState } from './pan-zoom.js';

// panX, panY, zoom 等の変数宣言を置換
const pz = createPanZoomState();

// 既存コードの panX, panY, zoom 参照を pz.panX, pz.panY, pz.zoom に変更
// setupPanZoom() 呼び出しを更新
```

- [ ] **Step 3: ビルドして動作確認**

```bash
npm run build
```
Expected: エラーなし

- [ ] **Step 4: ブラウザで動作確認**

```bash
npm run dev -- test.mmd
```
パン（中クリックドラッグ）とズーム（ホイール）が正常に動作することを確認。

- [ ] **Step 5: コミット**

```bash
git add src/client/pan-zoom.ts src/client/main.ts
git commit -m "refactor: pan-zoom.tsをmain.tsから分離"
```

---

### Task 10: main.ts分割 — highlight.ts

**Files:**
- Create: `src/client/highlight.ts`
- Modify: `src/client/main.ts`

- [ ] **Step 1: highlight.tsを作成**

`src/client/main.ts` から以下を抽出（**Task 9完了後のmain.tsを対象。関数名で特定**）:
- `selectedEntity` 変数
- `handleEntityClick()` 関数
- `buildDirectedGraph()` 関数
- `highlightRelated()` 関数
- `clearHighlight()` 関数

```typescript
// src/client/highlight.ts
import type { ERDiagramJSON } from '../parser/types.js';

export interface HighlightState {
  selectedEntity: string | null;
}

export interface HighlightDeps {
  getDiagram: () => ERDiagramJSON | null;
  getEntitiesGroup: () => SVGGElement;
  getConnectorsGroup: () => SVGGElement;
  onEntitySelected: (name: string | null) => void;
}

export function createHighlightState(): HighlightState {
  return { selectedEntity: null };
}

export function buildDirectedGraph(diagram: ERDiagramJSON): Map<string, Set<string>> {
  // main.ts の buildDirectedGraph() のロジックをここに移動
}

export function highlightRelated(
  state: HighlightState,
  deps: HighlightDeps,
  entityName: string
): void {
  // main.ts の highlightRelated() のロジックをここに移動
}

export function clearHighlight(deps: HighlightDeps): void {
  // main.ts の clearHighlight() のロジックをここに移動
}

export function handleEntityClick(
  state: HighlightState,
  deps: HighlightDeps,
  entityName: string
): void {
  // main.ts の handleEntityClick() のロジックをここに移動
}
```

- [ ] **Step 2: main.tsから該当コードを削除し、highlight.tsをimport**

- [ ] **Step 3: ビルド + 動作確認**

```bash
npm run build
```
ブラウザでエンティティクリック時のハイライトが正常に動作することを確認。

- [ ] **Step 4: コミット**

```bash
git add src/client/highlight.ts src/client/main.ts
git commit -m "refactor: highlight.tsをmain.tsから分離"
```

---

### Task 11: main.ts分割 — label-editor.ts

**Files:**
- Create: `src/client/label-editor.ts`
- Modify: `src/client/main.ts`

- [ ] **Step 1: label-editor.tsを作成**

`src/client/main.ts` から以下を抽出（**Task 10完了後のmain.tsを対象**）:
- `showLabelEditor()` 関数

```typescript
// src/client/label-editor.ts
import type { LayoutData } from '../parser/types.js';

export interface LabelEditorDeps {
  getLayout: () => LayoutData | null;
  getSvg: () => SVGSVGElement;
  getZoom: () => number;
  scheduleSaveLayout: () => void;  // main.ts の保存スケジューラ
  rerender: () => void;            // renderer.render() + updateViewportTransform()
}

export function showLabelEditor(
  deps: LabelEditorDeps,
  entityName: string,
  currentLabel: string,
  rect: DOMRect
): void {
  // main.ts の showLabelEditor() のロジックをここに移動
  // saveLayout() 直接呼び出しではなく deps.scheduleSaveLayout() 経由
  // renderer.render() 呼び出しは deps.rerender() 経由
}
```

- [ ] **Step 2: main.tsから該当コードを削除し、label-editor.tsをimport**

- [ ] **Step 3: ビルド + 動作確認**

```bash
npm run build
```
ブラウザでエンティティダブルクリック時のラベル編集が正常に動作することを確認。

- [ ] **Step 4: 全テスト実行**

```bash
npx vitest run
```
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/client/label-editor.ts src/client/main.ts
git commit -m "refactor: label-editor.tsをmain.tsから分離"
```

---

## Phase 2: 機能追加

### Task 12: エクスポート — SVGダウンロード

**Files:**
- Create: `src/client/export.ts`
- Modify: `src/client/index.html` (ツールバーにボタン追加)
- Modify: `src/client/styles.css` (ボタンスタイル)
- Modify: `src/client/main.ts` (ボタンイベント)

- [ ] **Step 1: export.tsにSVGエクスポート関数を作成**

```typescript
// src/client/export.ts

export function exportSVG(svgElement: SVGSVGElement, filename: string): void {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  const viewport = clone.querySelector('#viewport') as SVGGElement;

  // ビューポート変換を解除してバウンディングボックスを計算
  viewport.removeAttribute('transform');

  // CSSスタイルをインライン化
  inlineStyles(clone);

  // 全エンティティのバウンディングボックスからviewBoxを計算
  const bbox = calculateBBox(svgElement);
  const padding = 20;
  clone.setAttribute('viewBox',
    `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`
  );
  clone.setAttribute('width', String(bbox.width + padding * 2));
  clone.setAttribute('height', String(bbox.height + padding * 2));

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
    '--accent',
  ];
  // CSS変数の実際の値を取得してインラインスタイルに変換
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  let css = ':root {';
  for (const v of cssVars) {
    css += `${v}: ${computed.getPropertyValue(v).trim()};`;
  }
  css += '}';
  style.textContent = css;
  svg.insertBefore(style, svg.firstChild);
}

function calculateBBox(svg: SVGSVGElement): DOMRect {
  const viewport = svg.querySelector('#viewport') as SVGGElement;
  return viewport.getBBox();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: index.htmlにエクスポートボタン追加**

`src/client/index.html` の `toolbar-buttons` div内（~行19のbtn-auto-layout後）に追加:
```html
<button id="btn-export-svg" title="SVG保存">SVG</button>
<button id="btn-export-png" title="PNG保存">PNG</button>
<button id="btn-clipboard" title="クリップボードにコピー">Copy</button>
```

- [ ] **Step 3: main.tsにボタンイベント登録**

```typescript
import { exportSVG } from './export.js';

// init() 内に追加
document.getElementById('btn-export-svg')?.addEventListener('click', () => {
  const filename = layout?.diagramFile?.replace('.mmd', '.svg') || 'diagram.svg';
  exportSVG(svg, filename);
});
```

- [ ] **Step 4: ビルド + ブラウザでSVGダウンロード確認**

```bash
npm run build && npm run dev -- test.mmd
```
SVGボタンをクリックしてファイルがダウンロードされることを確認。

- [ ] **Step 5: コミット**

```bash
git add src/client/export.ts src/client/index.html src/client/main.ts src/client/styles.css
git commit -m "feat: SVGエクスポート機能追加"
```

---

### Task 13: エクスポート — PNG + クリップボード

**Files:**
- Modify: `src/client/export.ts`
- Modify: `src/client/main.ts`
- Modify: `src/client/styles.css` (トースト通知)

- [ ] **Step 0: toast.tsを作成（showToast共有ユーティリティ）**

`src/client/toast.ts` を新規作成。main.tsに既存の `showToast` があればそれを削除し、toast.tsからimportに変更する:

```typescript
// src/client/toast.ts
export function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
```

- [ ] **Step 1: export.tsにPNGエクスポートとクリップボードコピーを追加**

```typescript
// src/client/export.ts に追加

const MAX_CANVAS_SIZE = 4096;

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
  inlineStyles(clone);

  const bbox = calculateBBox(svgElement);
  const padding = 20;
  const w = bbox.width + padding * 2;
  const h = bbox.height + padding * 2;

  clone.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${w} ${h}`);

  // Retina 2x、ただし最大サイズ制限
  let scale = 2;
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

// showToast は src/client/toast.ts から import する（main.ts にも既存実装あり → 共有化）
import { showToast } from './toast.js';

// src/client/toast.ts（新規作成）:
// export function showToast(message: string): void {
//   const toast = document.createElement('div');
//   toast.className = 'toast';
//   toast.textContent = message;
//   document.body.appendChild(toast);
//   requestAnimationFrame(() => toast.classList.add('visible'));
//   setTimeout(() => {
//     toast.classList.remove('visible');
//     setTimeout(() => toast.remove(), 300);
//   }, 2000);
// }
```

- [ ] **Step 2: styles.cssにトーストスタイル追加**

```css
.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--accent);
  color: var(--header-text, #fff);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.3s, transform 0.3s;
  z-index: 1000;
  pointer-events: none;
}
.toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```

- [ ] **Step 3: main.tsにPNG・クリップボードボタンのイベント登録**

```typescript
import { exportSVG, exportPNG, copyToClipboard } from './export.js';

document.getElementById('btn-export-png')?.addEventListener('click', () => {
  const filename = layout?.diagramFile?.replace('.mmd', '.png') || 'diagram.png';
  exportPNG(svg, filename);
});

document.getElementById('btn-clipboard')?.addEventListener('click', () => {
  copyToClipboard(svg);
});
```

- [ ] **Step 4: ビルド + ブラウザで確認**

PNG保存とクリップボードコピーが動作することを確認。

- [ ] **Step 5: コミット**

```bash
git add src/client/export.ts src/client/main.ts src/client/styles.css
git commit -m "feat: PNGエクスポートとクリップボードコピー追加"
```

---

### Task 14: 検索機能

**Files:**
- Create: `src/client/search.ts`
- Modify: `src/client/index.html`
- Modify: `src/client/styles.css`
- Modify: `src/client/main.ts`

- [ ] **Step 1: search.tsを作成**

```typescript
// src/client/search.ts
import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

export interface SearchDeps {
  getDiagram: () => ERDiagramJSON | null;
  getLayout: () => LayoutData | null;
  panToEntity: (entityName: string) => void;
}

export interface SearchState {
  query: string;
  matches: string[];   // マッチしたエンティティ名
  currentIndex: number;
  filterMode: boolean;
}

export function createSearchState(): SearchState {
  return { query: '', matches: [], currentIndex: -1, filterMode: false };
}

export function search(
  state: SearchState,
  deps: SearchDeps,
  query: string
): string[] {
  state.query = query;
  if (!query) {
    state.matches = [];
    state.currentIndex = -1;
    return [];
  }

  const diagram = deps.getDiagram();
  const layout = deps.getLayout();
  if (!diagram) return [];

  const lower = query.toLowerCase();
  const matches: string[] = [];

  for (const [name, entity] of Object.entries(diagram.entities)) {
    const label = layout?.labels?.[name] || entity.label || '';
    // エンティティ名、ラベル、カラム名で検索
    if (
      name.toLowerCase().includes(lower) ||
      label.toLowerCase().includes(lower) ||
      entity.attributes.some(a => a.name.toLowerCase().includes(lower))
    ) {
      matches.push(name);
    }
  }

  state.matches = matches;
  state.currentIndex = matches.length > 0 ? 0 : -1;

  if (state.currentIndex >= 0) {
    deps.panToEntity(matches[0]);
  }

  return matches;
}

export function nextMatch(state: SearchState, deps: SearchDeps): void {
  if (state.matches.length === 0) return;
  state.currentIndex = (state.currentIndex + 1) % state.matches.length;
  deps.panToEntity(state.matches[state.currentIndex]);
}

export function prevMatch(state: SearchState, deps: SearchDeps): void {
  if (state.matches.length === 0) return;
  state.currentIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length;
  deps.panToEntity(state.matches[state.currentIndex]);
}
```

- [ ] **Step 2: index.htmlに検索バーHTML追加**

`#toolbar` の後に追加:
```html
<div id="search-bar" style="display: none;">
  <input id="search-input" type="text" placeholder="エンティティ / カラム名で検索...">
  <span id="search-count"></span>
  <button id="btn-filter" title="フィルタ切替">Filter</button>
  <button id="btn-search-close" title="閉じる">×</button>
</div>
```

ツールバーに検索ボタン追加:
```html
<button id="btn-search" title="検索 (Ctrl+F)">Search</button>
```

- [ ] **Step 3: styles.cssに検索バースタイル追加**

```css
#search-bar {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0 0 8px 8px;
  z-index: 20;
}
#search-input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px 8px;
  border-radius: 4px;
  width: 240px;
  font-size: 14px;
}
#search-count { color: var(--text-muted); font-size: 12px; }
.entity-search-match { outline: 2px solid var(--accent); outline-offset: 2px; }
.entity-search-dimmed { opacity: 0.15; }
.connector-search-dimmed { opacity: 0.15; }
```

- [ ] **Step 4: main.tsに検索UIイベント登録**

```typescript
import {
  createSearchState, search, nextMatch, prevMatch, type SearchState
} from './search.js';

const searchState = createSearchState();
const searchDeps = { getDiagram, getLayout, panToEntity };

// Ctrl+F で検索バー表示
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    toggleSearchBar(true);
  }
  if (e.key === 'Escape') toggleSearchBar(false);
});

// 入力時にインクリメンタル検索
searchInput.addEventListener('input', () => {
  const matches = search(searchState, searchDeps, searchInput.value);
  updateSearchHighlights(searchState);
  searchCount.textContent = matches.length > 0
    ? `${searchState.currentIndex + 1}/${matches.length}`
    : '';
});

// Enter / Shift+Enter で次/前
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.shiftKey ? prevMatch(searchState, searchDeps) : nextMatch(searchState, searchDeps);
    updateSearchHighlights(searchState);
  }
});
```

- [ ] **Step 5: フィルタモード（半透明化）の実装**

フィルタボタンのトグルで `searchState.filterMode` を切り替え、マッチしないエンティティとコネクタに `.entity-search-dimmed` / `.connector-search-dimmed` クラスを付与。

- [ ] **Step 6: ビルド + ブラウザで確認**

```bash
npm run build && npm run dev -- test.mmd
```
Ctrl+Fで検索、フィルタON/OFFを確認。

- [ ] **Step 7: コミット**

```bash
git add src/client/search.ts src/client/index.html src/client/styles.css src/client/main.ts
git commit -m "feat: 検索/フィルタ機能追加"
```

---

### Task 15: ダークモード/ライトモード切替

**Files:**
- Modify: `src/client/styles.css`
- Modify: `src/client/index.html`
- Modify: `src/client/main.ts`

- [ ] **Step 1: styles.cssのCSS変数をテーマセレクタに移行**

1. 現在の `:root` のCSS変数定義（行10-31）はそのまま残す（デフォルト=ダーク）
2. `--header-text: #1a1b26;` を `:root` に追加
3. `[data-theme="dark"]` セレクタに現在と同じ値をコピー
4. `[data-theme="light"]` セレクタにライトテーマの値を追加（スペックの全20変数を定義）

- [ ] **Step 2: index.htmlにテーマ切替ボタン追加**

ツールバーに追加:
```html
<button id="btn-theme" title="テーマ切替">🌙</button>
```

- [ ] **Step 3: main.tsにテーマ切替ロジック追加**

```typescript
// テーマ初期化
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeButton(savedTheme);

document.getElementById('btn-theme')?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
});

function updateThemeButton(theme: string): void {
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
}
```

- [ ] **Step 4: ビルド + 両テーマの表示確認**

```bash
npm run build && npm run dev -- test.mmd
```
テーマボタンでダーク↔ライトが切り替わり、全要素の色が正しいことを確認。

- [ ] **Step 5: コミット**

```bash
git add src/client/styles.css src/client/index.html src/client/main.ts
git commit -m "feat: ダーク/ライトモード切替追加"
```

---

### Task 16: タッチ操作対応

**Files:**
- Modify: `src/client/pan-zoom.ts`

**前提:** Task 9 で `pan-zoom.ts` が分割済み。

- [ ] **Step 1: pan-zoom.tsにタッチイベントハンドラ追加**

```typescript
// pan-zoom.ts の setupPanZoom() 内に追加

// --- タッチ操作 ---
let touchStartTime = 0;
let touchStartPos = { x: 0, y: 0 };
let lastTouchDist = 0;

deps.svg.addEventListener('touchstart', (e: TouchEvent) => {
  if (e.touches.length === 1) {
    // 1本指 → パン準備
    const touch = e.touches[0];
    touchStartTime = Date.now();
    touchStartPos = { x: touch.clientX, y: touch.clientY };
    state.isPanning = true;
    state.panStartX = touch.clientX;
    state.panStartY = touch.clientY;
    state.panStartPanX = state.panX;
    state.panStartPanY = state.panY;
  } else if (e.touches.length === 2) {
    // 2本指 → ピンチズーム準備
    state.isPanning = false;
    lastTouchDist = getTouchDist(e.touches);
  }
}, { passive: false });

deps.svg.addEventListener('touchmove', (e: TouchEvent) => {
  e.preventDefault();
  if (e.touches.length === 1 && state.isPanning) {
    const touch = e.touches[0];
    state.panX = state.panStartPanX + (touch.clientX - state.panStartX);
    state.panY = state.panStartPanY + (touch.clientY - state.panStartY);
    deps.onTransformChange();
  } else if (e.touches.length === 2) {
    const dist = getTouchDist(e.touches);
    const scale = dist / lastTouchDist;
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * scale));
    // ピンチ中心を基点にズーム
    state.panX = midX - (midX - state.panX) * (newZoom / state.zoom);
    state.panY = midY - (midY - state.panY) * (newZoom / state.zoom);
    state.zoom = newZoom;
    lastTouchDist = dist;
    deps.onTransformChange();
  }
}, { passive: false });

deps.svg.addEventListener('touchend', (e: TouchEvent) => {
  if (e.changedTouches.length === 1) {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartPos.x;
    const dy = touch.clientY - touchStartPos.y;
    const dt = Date.now() - touchStartTime;
    // タップ判定: 移動 < 10px かつ 300ms以内
    if (Math.hypot(dx, dy) < 10 && dt < 300) {
      deps.onTap?.(touch.clientX, touch.clientY);
    }
  }
  state.isPanning = false;
});

function getTouchDist(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}
```

`PanZoomDeps` に `onTap?: (x: number, y: number) => void` を追加。

- [ ] **Step 2: main.tsでonTapコールバック設定**

```typescript
// main.ts の setupPanZoom 呼び出し時
setupPanZoom(pz, {
  svg,
  onTransformChange: updateViewportTransform,
  onTap: (x, y) => {
    // タップ位置のエンティティを検出して選択
    const el = document.elementFromPoint(x, y);
    // ... 既存のクリックハンドラと同等のロジック
  },
});
```

- [ ] **Step 3: ビルド確認**

```bash
npm run build
```
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/client/pan-zoom.ts src/client/main.ts
git commit -m "feat: タッチ操作対応（パン/ズーム/タップ）"
```

---

## Phase 3: 差別化

### Task 17: ミニマップ

**Files:**
- Create: `src/client/minimap.ts`
- Modify: `src/client/index.html`
- Modify: `src/client/styles.css`
- Modify: `src/client/main.ts`

- [ ] **Step 1: minimap.tsを作成**

```typescript
// src/client/minimap.ts
import type { LayoutData } from '../parser/types.js';

export interface MinimapDeps {
  getLayout: () => LayoutData | null;
  getEntitySizes: () => Map<string, { width: number; height: number }>;
  getPanZoom: () => { panX: number; panY: number; zoom: number };
  getSvgSize: () => { width: number; height: number };
  onNavigate: (panX: number, panY: number) => void;
}

export class Minimap {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private deps: MinimapDeps;
  private visible = true;
  private rafId = 0;

  constructor(container: HTMLDivElement, deps: MinimapDeps) {
    this.container = container;
    this.canvas = container.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.deps = deps;
    this.setupInteraction();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.scheduleRedraw();
  }

  scheduleRedraw(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.draw();
    });
  }

  private draw(): void {
    // 1. 全エンティティのバウンディングボックス計算
    // 2. 縮小率を計算
    // 3. エンティティを簡易矩形で描画（グループカラー対応）
    // 4. ビューポート矩形を描画
  }

  private setupInteraction(): void {
    // クリック/ドラッグでビューポートを移動
    let isDragging = false;
    this.canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      this.navigateToPoint(e);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (isDragging) this.navigateToPoint(e);
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
  }

  private navigateToPoint(e: MouseEvent): void {
    // キャンバス座標 → ER図座標に変換してonNavigateを呼ぶ
  }
}
```

- [ ] **Step 2: index.htmlにミニマップコンテナ追加**

SVGの後に追加:
```html
<div id="minimap">
  <canvas width="200" height="150"></canvas>
</div>
```

ツールバーにトグルボタン追加:
```html
<button id="btn-minimap" title="ミニマップ">Map</button>
```

- [ ] **Step 3: styles.cssにミニマップスタイル追加**

```css
#minimap {
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  opacity: 0.85;
  z-index: 15;
}
#minimap canvas { border-radius: 4px; cursor: crosshair; }
```

- [ ] **Step 4: main.tsでMinimap初期化とイベント接続**

- [ ] **Step 5: ビルド + ブラウザで確認**

ミニマップが表示され、クリックでビューポートが移動することを確認。

- [ ] **Step 6: コミット**

```bash
git add src/client/minimap.ts src/client/index.html src/client/styles.css src/client/main.ts
git commit -m "feat: ミニマップ追加"
```

---

### Task 18: エンティティのグループ化/色分け

**Files:**
- Modify: `src/server/layout-schema.ts` (groupsフィールド追加)
- Modify: `src/parser/types.ts` (LayoutDataにgroups追加)
- Modify: `src/client/renderer.ts` (グループカラー適用)
- Modify: `src/client/main.ts` (コンテキストメニュー)
- Modify: `src/client/styles.css` (メニュー・カラーピッカースタイル)
- Modify: `src/client/minimap.ts` (グループカラー反映)

- [ ] **Step 1: types.tsにgroups型を追加**

```typescript
// src/parser/types.ts の LayoutData に追加
groups?: {
  [groupName: string]: {
    color: string;
    entities: string[];
  };
};
```

- [ ] **Step 2: layout-schema.tsにgroupsフィールド追加**

```typescript
// layoutDataSchema に追加
groups: z.record(z.object({
  color: z.string(),
  entities: z.array(z.string()),
})).optional(),
```

- [ ] **Step 3: renderer.tsでグループカラーをヘッダーに適用**

エンティティ描画時に `layout.groups` からエンティティが属するグループを探し、見つかればヘッダーのfill色をグループカラーに変更。

- [ ] **Step 4: コンテキストメニューUI実装**

右クリック → グループ名入力 + カラーピッカー + 既存グループ選択のメニューを表示。

- [ ] **Step 5: グループ変更時にlayout保存 + minimap再描画**

- [ ] **Step 6: ビルド + ブラウザで確認**

右クリックでグループ設定、ヘッダー色の変更、ミニマップへの反映を確認。

- [ ] **Step 7: コミット**

```bash
git add src/parser/types.ts src/server/layout-schema.ts src/client/renderer.ts src/client/main.ts src/client/styles.css src/client/minimap.ts
git commit -m "feat: エンティティのグループ化と色分け"
```

---

### Task 19: MCPツール auto-layout

**Files:**
- Create: `src/shared/auto-layout.ts`
- Modify: `src/client/layout.ts` (共有モジュール利用に変更)
- Modify: `src/mcp-server.ts` (ツール追加)

- [ ] **Step 1: layout.tsから純粋なレイアウト計算ロジックを抽出**

`src/client/layout.ts` のアルゴリズム部分（Sugiyama, force, community）を `src/shared/auto-layout.ts` に移動。DOMやSVGに依存しない純粋な計算関数のみ。

```typescript
// src/shared/auto-layout.ts
import type { ERDiagramJSON } from '../parser/types.js';

export type LayoutAlgorithm = 'sugiyama' | 'force' | 'community';

export interface EntityPositions {
  [entityName: string]: { x: number; y: number };
}

export function computeAutoLayout(
  diagram: ERDiagramJSON,
  algorithm: LayoutAlgorithm = 'sugiyama',
  entitySizes?: Record<string, { width: number; height: number }>
): EntityPositions {
  switch (algorithm) {
    case 'sugiyama': return sugiyamaLayout(diagram, entitySizes);
    case 'force': return forceLayout(diagram, entitySizes);
    case 'community': return communityLayout(diagram, entitySizes);
  }
}

// 各アルゴリズムの実装を layout.ts から移植
```

- [ ] **Step 2: layout.tsを共有モジュールのimportに変更**

```typescript
// src/client/layout.ts
import { computeAutoLayout, type LayoutAlgorithm } from '../shared/auto-layout.js';

// 既存の autoLayoutAll() 等を computeAutoLayout() を使うようにリファクタ
```

- [ ] **Step 3: ビルドしてクライアント側が壊れていないことを確認**

```bash
npm run build
```

- [ ] **Step 4: mcp-server.tsにauto-layoutツール追加**

```typescript
// src/mcp-server.ts に追加
import { computeAutoLayout } from './shared/auto-layout.js';

server.tool(
  'auto-layout',
  '開いている図のエンティティを自動整列する',
  {
    algorithm: z.enum(['sugiyama', 'force', 'community']).optional()
      .describe('レイアウトアルゴリズム (default: sugiyama)'),
  },
  async ({ algorithm }) => {
    if (!viewerState) {
      return { content: [{ type: 'text', text: 'Error: No diagram is open' }] };
    }
    const { diagram, layoutStore } = viewerState;
    const layout = layoutStore.load();
    if (!diagram || !layout) {
      return { content: [{ type: 'text', text: 'Error: No layout loaded' }] };
    }

    const positions = computeAutoLayout(diagram, algorithm || 'sugiyama');
    layout.entities = positions;
    layoutStore.save(layout);

    // WebSocket通知（viewerが開いていれば自動更新される）
    return {
      content: [{
        type: 'text',
        text: `Auto-layout applied (${algorithm || 'sugiyama'}): ${Object.keys(positions).length} entities positioned`,
      }],
    };
  }
);
```

- [ ] **Step 5: esbuild.config.mjsで共有モジュールがバンドルに含まれることを確認**

esbuildは `import` を辿って自動的にバンドルするため、追加設定は不要のはず。ビルドして確認:

```bash
npm run build
```

- [ ] **Step 6: MCPツールの動作確認**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npm run mcp
```
`auto-layout` がツールリストに含まれることを確認。

- [ ] **Step 7: コミット**

```bash
git add src/shared/auto-layout.ts src/client/layout.ts src/mcp-server.ts
git commit -m "feat: auto-layout MCPツール追加"
```

---

## 全Phase完了後

- [ ] **全テスト実行**

```bash
npx vitest run
```
Expected: ALL PASS

- [ ] **ビルド確認**

```bash
npm run build
```
Expected: エラーなし

- [ ] **ブラウザで全機能の最終確認**

チェックリスト:
- パン/ズーム（マウス + タッチ）
- エンティティ選択 + ハイライト
- ラベル編集
- エクスポート（SVG, PNG, クリップボード）
- 検索 + フィルタ
- テーマ切替（ダーク/ライト）
- ミニマップ表示/非表示
- グループ化/色分け
- auto-layout MCPツール
