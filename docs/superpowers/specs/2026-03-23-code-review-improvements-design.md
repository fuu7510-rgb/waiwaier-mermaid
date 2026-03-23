# Mermaid ER Viewer — コードレビュー改善設計

コードレビュー（docs/code-review.md）の全指摘事項を3フェーズで段階的に改善する設計。

---

## フェーズ構成

| Phase | テーマ | 内容 |
|-------|--------|------|
| Phase 1 | 基盤強化 | テスト導入、セキュリティ修正、バリデーション、競合制御改善、main.ts分割 |
| Phase 2 | 機能追加 | エクスポート、検索/フィルタ、テーマ切替、タッチ対応 |
| Phase 3 | 差別化 | ミニマップ、グループ化/色分け、auto-layout MCPツール |

各フェーズ完了時点でリリース可能な状態を保つ。Phase 1でコード品質を上げてからPhase 2で機能追加し、新機能にもテストを書きやすくする。

**注:** Zod v4（`^4.3.6`）を使用。プロジェクトにインストール済み。

### 既知の制限事項（対象外）

| 項目 | 理由 |
|------|------|
| `render()` の全DOM再構築（`innerHTML = ''`） | 差分更新への移行は影響範囲が広く、Phase 2の機能追加（検索ハイライト、テーマ切替）と相互依存する。Phase 2完了後に独立したリファクタとして検討する。現状でもrAFスロットリングとビューポートカリングで実用上のパフォーマンスは確保されている |
| .mmd差分ハイライト | 低優先度。ブレスト時に対象外と決定 |
| 複数ファイル同時表示 | 低優先度。ブレスト時に対象外と決定 |

---

## Phase 1: 基盤強化

### 1-1. テスト基盤 + パーサーテスト

**vitest導入:**
- `vitest` を devDependencies に追加
- `vitest.config.ts` を作成（esbuild既存のため設定は最小限）
- `npm run test` スクリプト追加

**テスト対象と方針:**

| モジュール | テスト内容 |
|-----------|-----------|
| `er-parser.ts` | 正常系（エンティティ、リレーション、属性）、エッジケース（空行、コメント、不正構文、`erDiagram`後のタイトル行）、Entity.label `["..."]` 構文、パラメータ付き型（`varchar(255)`等）の非対応を文書化するfailingテスト |
| `layout-store.ts` | load/save/contentHash計算、ファイル未存在時の挙動 |
| `cardinality.ts` | カーディナリティ記号の解析 |

**テストファイル配置:** `src/__tests__/` ディレクトリ（`er-parser.test.ts` など）

**サーバーAPIテスト:** パストラバーサル防止（1-2）のヘルパー関数はユニットテストで検証。加えて、`/api/browse` と `/api/open` の統合テスト（supertest）もPhase 1で最小限導入し、パストラバーサルが実際にブロックされることを確認する。

### 1-2. パストラバーサル防止

**対象エンドポイント:**
- `GET /api/browse` — ディレクトリ一覧
- `POST /api/open` — .mmdファイルを開く

**修正方針:**
- `resolve()` した結果が `baseDir` 配下であることを検証するヘルパー関数を作成
- チェック失敗時は `403 Forbidden` を返す

```typescript
import { resolve, sep } from 'path';

function assertWithinBase(targetPath: string, baseDir: string): void {
  let resolved = resolve(targetPath);
  let base = resolve(baseDir);
  // Windows: ドライブレターの大文字小文字を正規化
  if (process.platform === 'win32') {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1);
    base = base.charAt(0).toUpperCase() + base.slice(1);
  }
  if (!resolved.startsWith(base + sep) && resolved !== base) {
    throw new Error('Path traversal detected');
  }
}
```

- `/api/browse` と `/api/open` の両方で呼び出し
- Windows環境でのドライブレター大文字小文字差異を正規化（`c:\` vs `C:\`）
- ヘルパー関数自体もユニットテスト対象（Windows/Unix両パターン）

### 1-3. PUT /api/layout の zodバリデーション

**修正方針:**
- `src/server/layout-schema.ts` に zod スキーマを定義
- `PUT /api/layout` で `safeParse` し、失敗なら `400 Bad Request` + エラー詳細を返す

```typescript
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
// .strip() で未知のフィールド（_schema等）を除去して受け入れる
// layout-store.ts の save() が付与する _schema メタデータフィールドは
// 読み込み時にJSONに含まれるため、バリデーションで拒否しないようにする
```

- スキーマのテストも追加（正常系 + 不正データ拒否 + `_schema`付きデータの受け入れ確認）
- **注:** `groups` フィールドはPhase 3で追加する。Phase 1時点ではスキーマに含めない

### 1-4. layoutSaving 競合制御の改善

**現状の問題:**
`server.ts` で `PUT /api/layout` 後に `setTimeout(() => { layoutSaving = false; }, 500)` で500ms間ファイル監視を抑制している。このタイミング依存はディスクI/Oが遅い環境や高負荷時に競合する。

**修正方針:**
- タイムアウトベースのフラグではなく、書き込み時のcontentHashを記録する方式に変更
- 自分が書き込んだハッシュとファイル監視で検出した内容のハッシュを比較し、一致すれば自己変更として無視する

```typescript
// server.ts
let lastWrittenHash: string | null = null;

// PUT /api/layout ハンドラ内
layoutStore.save(validatedLayout);
// save() は _schema メタデータを付加してから書き込むため、
// ディスク上の実際の内容のハッシュを取得する必要がある。
// LayoutStore に saveAndGetHash() メソッドを追加し、
// 書き込んだ内容のハッシュを返すようにする。
lastWrittenHash = layoutStore.saveAndGetHash(validatedLayout);

// file-watcher の変更検出時
const currentContent = readFileSync(layoutPath, 'utf-8');
const currentHash = computeHash(currentContent);
if (currentHash === lastWrittenHash) {
  lastWrittenHash = null; // リセット
  return; // 自己変更 → 無視
}
// 外部変更 → ブロードキャスト
```

**LayoutStore の変更:**
```typescript
// layout-store.ts に追加
saveAndGetHash(layout: LayoutData): string {
  const output = { _schema: { /* ... */ }, ...layout };
  const content = JSON.stringify(output, null, 2);
  writeFileSync(this.layoutPath, content, 'utf-8');
  return this.computeHash(content);
}
```

- `setTimeout` / `layoutSaving` フラグを完全に削除
- この変更のテストも追加（layout-store.test.ts）

### 1-5. main.ts の3分割

**分割計画:**

| 新ファイル | 責務 | 推定行数 |
|-----------|------|---------|
| `pan-zoom.ts` | ホイールズーム、パンドラッグ、ビューポート変換、座標変換ユーティリティ | ~120行 |
| `highlight.ts` | ホバー/選択時のエンティティ・コネクタハイライト、関連エンティティ探索（buildDirectedGraph, highlightRelated, clearHighlight） | ~150行 |
| `label-editor.ts` | ダブルクリックでのラベルインライン編集、入力フィールド生成、API保存呼び出し | ~80行 |
| `main.ts`（残り） | 状態初期化、イベントバインド、WebSocket連携、render呼び出しのオーケストレーション | ~465行 |

**インターフェース設計:**
- 各モジュールは `init(state, deps)` 関数をエクスポート
- main.ts が初期化時に呼び出す
- 共有状態（diagram, layout, zoom等）は main.ts が保持し、各モジュールに渡す
- モジュール間の直接依存は避け、コールバックで接続

**制約:** 分割はリファクタのみ。機能追加はしない。

---

## Phase 2: 機能追加

### 2-1. エクスポート機能（SVG + PNG + クリップボードコピー）

**UI:** 画面右上ツールバーにエクスポートボタン3つ（SVG保存、PNG保存、クリップボードコピー）

**SVGエクスポート:**
- 現在のSVG要素をクローンし、ビューポート変換を解除して全体が収まるviewBoxを計算
- CSSスタイルをインライン化（自己完結SVG）
- `Blob` → `URL.createObjectURL` → `<a download>` クリックでダウンロード

**PNGエクスポート:**
- SVGを `Image` にロード → `Canvas` に描画 → `canvas.toBlob('image/png')`
- 解像度は2x（Retina対応）デフォルト。Canvasの最大サイズを4096x4096pxに制限し、超える場合はスケールを自動調整してブラウザのメモリ制限を回避する

**クリップボードコピー:**
- `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])` で書き込み
- 成功時にトースト通知「クリップボードにコピーしました」

**新ファイル:** `src/client/export.ts`

### 2-2. 検索/フィルタ機能

**UI:**
- `Ctrl+F` またはツールバー検索アイコンで検索バー表示（画面上部フローティング）
- ESCで閉じ、フィルタ解除

**検索:**
- エンティティ名、ラベル（日本語含む）、カラム名をインクリメンタル検索
- マッチしたエンティティをハイライトし、最初のマッチにビューをパン移動
- 上下矢印 / Enterで次/前のマッチに移動

**フィルタ:**
- 検索バー横にフィルタトグルボタン
- ON時：マッチしないエンティティを半透明化（opacity: 0.15）、コネクタも半透明化
- OFF時：通常表示に戻る

**新ファイル:** `src/client/search.ts`

### 2-3. ダークモード/ライトモード切替

**実装方針:**
- CSS変数ベースでテーマ定義（`[data-theme="dark"]` / `[data-theme="light"]`）
- 現在のTokyoNight系配色をダークテーマとしてCSS変数に抽出
- ライトテーマは明るい背景/暗いテキスト

**CSS変数方針:**
既存の `:root` で定義済みのCSS変数名（`--bg`, `--surface`, `--text`, `--border`, `--header-bg`, `--body-bg`, `--key-color`, `--type-color`, `--name-color`, `--comment-color`, `--connector-color`, `--connector-label`, `--accent`, `--accent-muted`, `--text-muted`, `--text-bright`, `--error-bg`, `--error-text`, `--surface-hover`）をそのまま使用する。変数名のリネームはしない。

```css
/* 現在の :root 定義をダークテーマとして移動 */
[data-theme="dark"] {
  --bg: #1a1b26;
  --surface: #24283b;
  --surface-hover: #292e42;
  --border: #3b4261;
  --text: #c0caf5;
  --text-muted: #565f89;
  --text-bright: #ffffff;
  --accent: #7aa2f7;
  --accent-muted: #3d59a1;
  --header-bg: #7aa2f7;
  --header-text: #1a1b26;
  --body-bg: #1f2335;
  --key-color: #bb9af7;
  --type-color: #2ac3de;
  --name-color: #c0caf5;
  --comment-color: #565f89;
  --connector-color: #565f89;
  --connector-label: #9aa5ce;
  --error-bg: #f7768e;
  --error-text: #1a1b26;
}
[data-theme="light"] {
  --bg: #f5f5f5;
  --surface: #ffffff;
  --surface-hover: #e8e8e8;
  --border: #d0d0d0;
  --text: #333333;
  --text-muted: #888888;
  --text-bright: #000000;
  --accent: #2563eb;
  --accent-muted: #93b4f5;
  --header-bg: #2563eb;
  --header-text: #ffffff;
  --body-bg: #fafafa;
  --key-color: #7c3aed;
  --type-color: #0891b2;
  --name-color: #333333;
  --comment-color: #888888;
  --connector-color: #aaaaaa;
  --connector-label: #666666;
  --error-bg: #ef4444;
  --error-text: #ffffff;
}
```
`:root` にはデフォルト値（ダークテーマ）を残し、`[data-theme]` セレクターでオーバーライドする。
**注:** 現在 `:root` に未定義だが使用されている `--header-text` も `:root` のデフォルト値に追加する。

**切替UI:** ツールバーに月/太陽アイコンのトグルボタン。選択は `localStorage` に保存。

**影響範囲:**
- `styles.css` — ハードコード色をCSS変数に置換
- `renderer.ts` — SVG内の色もCSS変数参照
- `export.ts` — エクスポート時に現在テーマの色をインライン化

### 2-4. タッチ操作対応（基本操作）

| ジェスチャー | 動作 |
|-------------|------|
| 1本指ドラッグ（背景上） | パン |
| ピンチイン/アウト | ズーム |
| タップ（エンティティ上） | 選択 |

**実装方針:**
- `pan-zoom.ts`（Phase 1で分割済み）にタッチイベントハンドラを追加
- `touchstart` / `touchmove` / `touchend` を処理
- ピンチは2点間距離の変化率でズーム倍率を計算
- `touch` イベント発生時は対応する `mouse` イベントを `preventDefault` で抑制
- `passive: false` でブラウザデフォルトのスクロール/ズームを抑制
- タップ判定：移動距離 < 10px かつ時間 < 300ms

**新ファイルは作らず `pan-zoom.ts` に統合。**

**依存関係:** Phase 1-5 で `pan-zoom.ts` を切り出し済みであることが前提。

---

## Phase 3: 差別化

### 3-1. ミニマップ

**UI:**
- 画面右下にSVGサムネイル表示（幅200px、半透明背景）
- ビューポート範囲を矩形で表示
- ミニマップ上のクリック/ドラッグでビューポート移動
- ツールバーに表示/非表示トグル

**実装方針:**
- `src/client/minimap.ts` を新規作成
- 全エンティティの位置からバウンディングボックスを計算し縮小率を決定
- エンティティは簡略化した矩形で描画（テキストなし、カラムなし）
- ビューポート矩形は現在のpan/zoom状態から計算
- パン/ズーム変更時にrAFスロットリングで再描画

### 3-2. エンティティのグループ化/色分け

**データモデル（layout.json拡張）:**
```typescript
groups?: {
  [groupName: string]: {
    color: string;       // "#ff6b6b" など
    entities: string[];  // エンティティ名の配列
  };
};
```

**UI:**
- エンティティのヘッダー背景色がグループカラーで着色
- ミニマップ上でもグループカラー反映
- コネクタの色は変えない

**操作:**
- エンティティ右クリック → コンテキストメニュー「グループ設定」
- グループ名入力 + カラーピッカーで色選択
- 既存グループへの追加（ドロップダウン）
- グループから外す操作も同メニューから

**MCP連携:** `save-layout` でグループ情報も保存可能に。

**zodスキーマ拡張:** Phase 3実装時に `layoutDataSchema` に `groups` フィールドを `.optional()` で追加する。Phase 1時点では含めない。

### 3-3. MCPツール: auto-layout

| 項目 | 内容 |
|------|------|
| ツール名 | `auto-layout` |
| 説明 | 開いている図のエンティティを自動整列する |
| パラメータ | `algorithm`: `"sugiyama"` \| `"force"` \| `"community"` (optional, デフォルト `"sugiyama"`) |
| 戻り値 | 整列後のエンティティ位置一覧と適用結果メッセージ |

**実装方針:**
- `src/mcp-server.ts` にツール追加
- `src/client/layout.ts` のレイアウトアルゴリズムを共有モジュール化
  - `src/shared/auto-layout.ts` に純粋なレイアウト計算ロジックを抽出
  - 共有モジュールは `ERDiagramJSON` 型（`Record<string, Entity>` ベース）を使用。MCPサーバーが既に `Map` → `Record` 変換を行っているため、これに合わせる。クライアント側は呼び出し時に変換する
  - クライアント・MCPサーバー両方からimport。esbuildは各バンドルで独立にこのモジュールを解決する
- 実行フロー:
  1. 現在のdiagramとlayoutを取得
  2. 指定アルゴリズムで新しい位置を計算
  3. `layout-store` 経由で保存
  4. WebSocketで `layout-changed` をブロードキャスト → ブラウザが自動更新
- パラメータの `algorithm` を zod enum でバリデーション

---

## ファイル変更サマリ

### 新規ファイル
| ファイル | Phase | 用途 |
|---------|-------|------|
| `vitest.config.ts` | 1 | テスト設定 |
| `src/__tests__/er-parser.test.ts` | 1 | パーサーテスト |
| `src/__tests__/layout-store.test.ts` | 1 | LayoutStoreテスト |
| `src/__tests__/cardinality.test.ts` | 1 | カーディナリティテスト |
| `src/__tests__/path-traversal.test.ts` | 1 | パス検証ユニットテスト |
| `src/__tests__/layout-schema.test.ts` | 1 | スキーマテスト |
| `src/__tests__/api-security.test.ts` | 1 | `/api/browse`, `/api/open` 統合テスト（supertest） |
| `src/server/layout-schema.ts` | 1 | zodバリデーションスキーマ |
| `src/client/pan-zoom.ts` | 1 | パン/ズーム制御 |
| `src/client/highlight.ts` | 1 | ハイライトロジック |
| `src/client/label-editor.ts` | 1 | ラベル編集UI |
| `src/client/export.ts` | 2 | エクスポート機能 |
| `src/client/search.ts` | 2 | 検索/フィルタ |
| `src/client/minimap.ts` | 3 | ミニマップ |
| `src/shared/auto-layout.ts` | 3 | 共有レイアウトアルゴリズム（`ERDiagramJSON`型ベース） |

### 変更ファイル
| ファイル | Phase | 変更内容 |
|---------|-------|---------|
| `package.json` | 1 | vitest・supertest追加、testスクリプト |
| `src/server/server.ts` | 1 | パス検証追加、zodバリデーション、layoutSaving競合制御改善 |
| `src/client/main.ts` | 1 | 3モジュール切り出しによる縮小 |
| `src/client/styles.css` | 2 | 既存CSS変数をテーマセレクタに移動、ライトテーマ追加、検索UI、エクスポートボタン |
| `src/client/index.html` | 2 | ツールバー拡張（エクスポート、検索、テーマ切替） |
| `src/client/renderer.ts` | 2,3 | CSS変数参照（変更なし、既に使用中）、グループカラー対応 |
| `src/client/pan-zoom.ts` | 2 | タッチイベントハンドラ追加 |
| `src/client/layout.ts` | 3 | 共有モジュールへのロジック移動 |
| `src/mcp-server.ts` | 3 | auto-layoutツール追加 |
| `src/server/layout-schema.ts` | 3 | groupsフィールド追加 |
