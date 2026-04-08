# コードレビュー結果

**プロジェクト**: Mermaid ER Diagram Viewer
**レビュー日**: 2026-04-08

---

## 重大度別サマリー

| 重大度 | 件数 | 概要 |
|--------|------|------|
| **CRITICAL** | 3 | パストラバーサル、WebSocket認証欠如 |
| **HIGH** | 5 | ファイルパス検証不足、エラー情報漏洩、レースコンディション |
| **MEDIUM** | 7 | 履歴メモリ、ファイル同期、ドラッグ解析、ローディング表示 |
| **LOW/その他** | 18 | 型安全性、パフォーマンス、アーキテクチャ |

---

## CRITICAL

### 1. パストラバーサル脆弱性

**場所**: `src/server/server.ts` — `/api/browse` エンドポイント (L85-134)

`/api/browse` エンドポイントで、解決後のパスが `baseDir` 内に収まっているかの検証がない。`?path=../../../etc/passwd` のようなリクエストでファイルシステム全体を閲覧可能。

```typescript
// 現状
const targetPath = req.query.path
  ? resolve(String(req.query.path))
  : baseDir;
```

**推奨修正**:

```typescript
const targetPath = resolve(String(req.query.path));
const realBaseDir = resolve(baseDir);
if (!targetPath.startsWith(realBaseDir + path.sep)) {
  res.status(400).json({ error: 'Invalid path' });
  return;
}
```

### 2. WebSocket認証なし

**場所**: `src/server/server.ts` (L50-54, L255-266)

WebSocket接続に認証がない。同一ネットワーク上の誰でも接続してファイル変更通知を受信可能。

```typescript
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected' }));
});
```

**推奨**: セッションベース認証またはトークン検証を実装する。

### 3. DOM操作におけるUnicodeホモグラフ攻撃の可能性

**場所**: `src/client/picker.ts` (L73-79, L113-140)

ファイルパスが `.textContent` でDOMに挿入される。`.innerHTML` より安全だが、Unicodeホモグラフ攻撃（キリル文字の 'a' vs ラテン文字の 'a' など）によるユーザー欺瞞の可能性がある。

---

## HIGH

### 4. POST /api/open のパス未検証

**場所**: `src/server/server.ts` (L137-177)

リクエストボディのファイルパスが `baseDir` 内かの検証がない。任意の `.mmd` ファイルを開ける。

```typescript
const filePath = resolve(file);  // 検証なし
```

### 5. エラーメッセージによる情報漏洩

**場所**: `src/server/server.ts` (L131-134, L174-177, L191-194)

例外の詳細をそのままクライアントに返しており、ファイルパスやスタックトレースが露出する可能性がある。

```typescript
catch (err: any) {
  res.status(500).json({ error: err.message });
}
```

**推奨修正**:

```typescript
catch (err: unknown) {
  console.error('Browse error:', err);
  res.status(500).json({ error: 'An error occurred' });
}
```

### 6. WebSocketメッセージのスキーマ検証なし

**場所**: `src/client/websocket.ts` (L13-20)

パース後のメッセージが期待する形状かの検証がない。

```typescript
try {
  const msg = JSON.parse(event.data);
  const handlers = this.handlers.get(msg.type) || [];
  handlers.forEach((h) => h(msg));
} catch {
  // ignore parse errors
}
```

### 7. レイアウト保存のレースコンディション

**場所**: `src/client/main.ts` (L79-91, L506)

外部からファイルが変更された場合、デバウンス中の未保存レイアウト変更が `loadAndRender()` によって上書きされる。

```typescript
ws.on('file-changed', async () => {
  await loadAndRender();  // レイアウト変更がマージされずに上書き
});
```

### 8. レイアウトデータの型検証なし

**場所**: `src/server/server.ts` (L246)

`req.body` を型アサーションのみでランタイム検証なしに保存。

```typescript
const layout = req.body as LayoutData;  // 検証なし
state.layoutStore.save(layout);
```

**推奨**: zod や io-ts 等でランタイム検証を追加する。

---

## MEDIUM

### 9. レイアウトファイルの非アトミック書き込み

**場所**: `src/server/layout-store.ts` (L32-34)

`writeFileSync` を直接使用しており、他プロセスが同時に読み取ると破損の可能性がある。

```typescript
save(layout: LayoutData): void {
  writeFileSync(this.layoutPath, JSON.stringify(layout, null, 2), 'utf-8');
}
```

**推奨**: 一時ファイルに書き込み後リネームするアトミックライトパターンを使用する。

### 10. Regex DoSの可能性

**場所**: `src/parser/er-parser.ts` (L6-7, L13-14)

`ATTRIBUTE_RE` が非常に長い行で問題を起こす可能性がある。

**推奨**: パース前に行の長さ制限を追加する (`if (line.length > 1000) continue;`)

### 11. ドラッグハンドラの transform 解析エラー

**場所**: `src/client/drag.ts` (L76-80)

`parseFloat()` が `NaN` を返した場合のバリデーションがない。

```typescript
this.startEntityX = match ? parseFloat(match[1]) : 0;
this.startEntityY = match ? parseFloat(match[2]) : 0;
```

**推奨**: `isNaN()` チェックを追加する。

### 12. ファイルオープン時のローディング表示なし

**場所**: `src/client/picker.ts` (L172-180)

非同期操作中にUIフィードバックがなく、ユーザーが複数回クリックする可能性がある。

### 13. キャンバス設定値の未検証

**場所**: `src/client/main.ts` (L548-553)

レイアウトファイルからの panX/panY/zoom が `NaN` や `Infinity` でもそのまま使用される。

```typescript
if (layout && layout.canvas) {
  panX = layout.canvas.panX;
  panY = layout.canvas.panY;
  zoom = layout.canvas.zoom;
}
```

**推奨**: `isFinite()` チェックと MIN/MAX クランプを追加する。

### 14. 履歴のメモリ管理

**場所**: `src/client/history.ts` (L11-35)

位置マップ全体を毎アクションでディープクローンしている。大規模ダイアグラムではメモリを圧迫する可能性がある。

### 15. CORS設定なし

**場所**: `src/server/server.ts`

明示的なCORS設定がない。クロスオリジンアクセスの想定がないなら問題ないが、ドキュメントに明記すべき。

---

## LOW

### 16. `catch (err: any)` の型安全性

**場所**: `src/server/server.ts` 複数箇所

`any` ではなく `unknown` を使用し、`instanceof Error` チェックを行うべき。

### 17. 関数の戻り値型の省略

**場所**: 複数ファイル

一部の関数で明示的な戻り値型アノテーションが欠けている。

### 18. SVG計測テキスト要素がDOMに残存

**場所**: `src/client/renderer.ts` (L68-78)

非表示の計測用テキスト要素がSVG DOMに追加されたまま。デタッチした要素での計測が望ましい。

### 19. 非効率なカリングチェック

**場所**: `src/client/renderer.ts` (L491-518)

全エンティティ・コネクタに対して毎回カリング判定を行っている。大規模図ではビューポート境界付近のみチェックすべき。

### 20. レイアウト計算のO(n²)複雑度

**場所**: `src/client/layout.ts` (L250-301)

モジュラリティ最適化ループが各ノードに対して最大20回反復。大規模グラフでハングの恐れあり。

### 21. 最近のファイル一覧の存在チェック

**場所**: `src/server/recent-store.ts` (L26-28)

毎回ファイルの存在を確認しているが、最大20件なので実質的な影響は小さい。

### 22. ハードコードされたファイル拡張子フィルタ

**場所**: `src/server/server.ts` (L109-111, L151-154)

`.mmd` のみ対応。設定可能にすると拡張性が向上する。

---

## アーキテクチャ上の懸念

### 23. `main.ts` の責務過多 (557行)

パン/ズーム、ハイライト、undo/redo、WebSocket管理、キーボードショートカットなど複数の責務が混在。以下のような分割を推奨:

- `viewport.ts` — パン/ズームロジック
- `selection.ts` — エンティティハイライト
- `keyboard.ts` — キーボードハンドラ
- `state.ts` — アプリケーション状態管理

### 24. グローバル変数による状態管理

**場所**: `src/client/main.ts` (L9-24)

モジュールレベル変数が散在。状態管理クラスまたはオブジェクトへの集約が望ましい。

### 25. Drag と Renderer の密結合

**場所**: `src/client/drag.ts` (L104-111)

`DragHandler` が直接 `renderer` のメソッドを呼び出している。コールバックやイベントによる疎結合が望ましい。

### 26. FileWatcher のエラー時クリーンアップ不足

**場所**: `src/server/server.ts` (L40-47)

`fileWatcher.start()` が例外を投げた場合のクリーンアップがない。

---

## 良い点

- `.mmd` ファイルを無加工のまま維持するサイドカーJSON設計は秀逸
- chokidar によるファイル監視 + WebSocket のライブリロードが実用的
- esbuild によるシンプルなビルド構成
- ファイルピッカー + 履歴管理のUXが使いやすい
- Crow's foot カーディナリティ記号の独自SVGレンダリング
- Louvainコミュニティ検出による自動グルーピングは高度な機能
