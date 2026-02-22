# Mermaid ER Diagram Viewer

Mermaid の ER 図（`.mmd`ファイル）をブラウザで表示し、エンティティをドラッグで自由に配置できるローカル Web ビューアーです。

## なぜ作ったか

Mermaid の ER 図は自動レイアウト（Dagre/ELK）で配置されるため、テーブル数が増えるとノードの位置がぐちゃぐちゃになり、DB 構造を視覚的に理解しづらくなります。

このツールは **`.mmd` ファイルを無加工のまま維持** しつつ、ノード座標だけをサイドカー JSON ファイル（`*.mmd.layout.json`）で管理します。エディター（VSCode / Zed / Terminal）で `.mmd` を編集するとブラウザが自動更新されるため、Claude Code などとの併用に最適です。

## 機能

- SVG によるカスタムレンダリング（Mermaid.js 不使用）
- エンティティのドラッグ＆ドロップ配置
- 座標のサイドカー JSON 自動保存
- `.mmd` ファイル監視によるライブリロード
- 直交線コネクタ＋ Crow's foot カーディナリティ記号
- パン（Ctrl+ドラッグ）＆ズーム（マウスホイール）
- テーブル選択時の親子関係ハイライト
- テキストクリックでコピー
- サイドカー JSON によるエンティティ日本語ラベル

## 使い方

```bash
npm install
npm run build
node dist/server/index.js <file.mmd>
```

ブラウザが自動で `http://localhost:3000` を開きます。

### オプション

```
--port <number>   ポート番号（デフォルト: 3000）
--no-open         ブラウザを自動で開かない
```

## 日本語ラベルの設定

`.mmd.layout.json` の `labels` にエンティティ名と日本語名の対応を記述します。

```json
{
  "labels": {
    "CUSTOMER": "顧客",
    "ORDER": "注文"
  }
}
```

## キーボードショートカット

| キー | 操作 |
|------|------|
| `Scroll` | ズーム |
| `Ctrl+Drag` | パン |
| `F` | 全体フィット |
| `L` | オートレイアウト |
| `Ctrl+0` | ズームリセット |
| `Esc` | ハイライト解除 |

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| バックエンド | Node.js + Express |
| ファイル監視 | chokidar |
| WebSocket | ws |
| フロントエンド | Vanilla TypeScript + SVG |
| ビルド | esbuild |
