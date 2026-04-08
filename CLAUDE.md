# Mermaid ER Viewer

## プロジェクト概要
Mermaid .mmd ER図をブラウザで表示・編集するツール。レイアウトは .mmd.layout.json サイドカーファイルに保存。
Claude Code用MCPサーバーとしても動作する。

## アーキテクチャ
- サーバー: Express + WebSocket (src/server/)
- クライアント: Vanilla TS + SVG (src/client/)
- パーサー: 独自の行ベースMermaid ERパーサー (src/parser/)
- MCPサーバー: stdio transport (src/mcp-server.ts)

## ビルド・実行
- `npm run build` — esbuildでサーバー・クライアント・MCPサーバーをバンドル
- `npm run dev -- file.mmd` — ビルド+起動（デフォルトport 3000）
- `npm run mcp` — MCPサーバー単体起動

## npm公開
- `npm version patch --no-git-tag-version && npm publish`
- パッケージ名: mermaid-er-viewer、MCP bin名: mermaid-er-viewer-mcp
- `files: ["dist/"]` — distのみ公開、`prepare` スクリプトでビルド自動実行

## MCP登録（Claude Code）
- bin名がパッケージ名と異なるため `-p` オプション必須:
  `npx -y -p mermaid-er-viewer mermaid-er-viewer-mcp`

## .mmdファイルの原則
- **Mermaid標準のER図構文のみ使用すること**。独自拡張構文を書き込まない
- エンティティの日本語名は Mermaid標準の `["..."]` 構文を使う: `USERS["ユーザー"] {`
- このツールはClaude Codeが標準Mermaidを理解・閲覧するための補助ツール
- .mmdファイルは他のMermaidツール（公式Live Editor等）でも開ける状態を維持する

## 実装上の注意
- サーバーは .mmd を読み取り専用。書き込むのは .layout.json のみ
- Entity.label（.mmd の ["..."] 構文）がエンティティの日本語名の唯一の情報源
- layout.json にはラベル情報を保存しない（位置・キャンバス状態のみ）
- PUT /api/layout 後は必ず WebSocket で layout-changed をブロードキャストする
- file-changed 時は flushSaveLayout() で未保存レイアウトを先に保存してから再読み込み
- fetch API には cache: 'no-store' を付けてブラウザキャッシュを回避する
