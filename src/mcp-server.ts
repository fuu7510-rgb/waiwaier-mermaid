import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { parseERDiagram } from './parser/er-parser.js';
import { LayoutStore } from './server/layout-store.js';
import { startServer } from './server/server.js';
import type { ERDiagramJSON } from './parser/types.js';

// __dirname is provided by esbuild banner
declare const __dirname: string;

const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

const server = new McpServer({
  name: 'mermaid-er-viewer',
  version: pkg.version,
});

// --- ツール: バージョン確認 ---
server.tool(
  'version',
  'MCPサーバーの現在のバージョンを返す',
  {},
  async () => {
    return { content: [{ type: 'text' as const, text: `mermaid-er-viewer v${pkg.version}` }] };
  },
);

// --- ツール: ER図をパース ---
server.tool(
  'parse-diagram',
  'Mermaid ER図ファイル(.mmd)をパースして、エンティティとリレーションシップの構造をJSONで返す',
  { filePath: z.string().describe('.mmdファイルの絶対パス') },
  async ({ filePath }) => {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) {
      return { content: [{ type: 'text' as const, text: `Error: ファイルが見つかりません: ${absPath}` }], isError: true };
    }
    const source = readFileSync(absPath, 'utf-8');
    const diagram = parseERDiagram(source);
    const json: ERDiagramJSON = {
      entities: Object.fromEntries(diagram.entities),
      relationships: diagram.relationships,
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(json, null, 2) }] };
  },
);

// --- ツール: .mmdファイル一覧 ---
server.tool(
  'list-mmd-files',
  '指定ディレクトリ内の.mmdファイルを再帰なしで一覧する',
  {
    directory: z.string().optional().describe('検索するディレクトリの絶対パス（省略時はカレントディレクトリ）'),
  },
  async ({ directory }) => {
    const dir = resolve(directory || process.cwd());
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return { content: [{ type: 'text' as const, text: `Error: ディレクトリが見つかりません: ${dir}` }], isError: true };
    }

    const entries = readdirSync(dir);
    const mmdFiles: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = join(dir, entry);
      try {
        if (statSync(fullPath).isFile() && entry.endsWith('.mmd')) {
          mmdFiles.push(fullPath);
        }
      } catch {
        // skip
      }
    }

    if (mmdFiles.length === 0) {
      return { content: [{ type: 'text' as const, text: `${dir} に .mmd ファイルはありません` }] };
    }
    return { content: [{ type: 'text' as const, text: mmdFiles.join('\n') }] };
  },
);

// --- ツール: レイアウト取得 ---
server.tool(
  'get-layout',
  'ER図のレイアウトデータ（エンティティ位置、ラベル、キャンバス状態）をJSONで返す',
  { filePath: z.string().describe('.mmdファイルの絶対パス') },
  async ({ filePath }) => {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) {
      return { content: [{ type: 'text' as const, text: `Error: ファイルが見つかりません: ${absPath}` }], isError: true };
    }

    const store = new LayoutStore(absPath);
    let layout = store.load();
    if (!layout) {
      const source = readFileSync(absPath, 'utf-8');
      layout = store.createDefault(source);
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(layout, null, 2) }] };
  },
);

// --- ツール: レイアウト保存 ---
server.tool(
  'save-layout',
  'ER図のレイアウトデータを保存する。labelsフィールドでエンティティの日本語名を設定できる',
  {
    filePath: z.string().describe('.mmdファイルの絶対パス'),
    labels: z
      .record(z.string(), z.string())
      .optional()
      .describe('エンティティの表示ラベル（例: {"users": "ユーザー", "orders": "注文"}）'),
    entities: z
      .record(z.string(), z.object({ x: z.number(), y: z.number() }))
      .optional()
      .describe('エンティティの位置（例: {"users": {"x": 100, "y": 200}}）'),
  },
  async ({ filePath, labels, entities }) => {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) {
      return { content: [{ type: 'text' as const, text: `Error: ファイルが見つかりません: ${absPath}` }], isError: true };
    }

    const store = new LayoutStore(absPath);
    const source = readFileSync(absPath, 'utf-8');
    let layout = store.load() || store.createDefault(source);

    if (labels) {
      layout.labels = { ...layout.labels, ...labels };
    }
    if (entities) {
      layout.entities = { ...layout.entities, ...entities };
    }

    store.save(layout);
    return { content: [{ type: 'text' as const, text: 'レイアウトを保存しました: ' + store.getLayoutPath() }] };
  },
);

// --- ツール: ビューワーを起動 ---
let activeViewer: { url: string; port: number } | null = null;

server.tool(
  'open-viewer',
  'ブラウザでER図ビューワーを起動する。起動済みの場合はURLを返す',
  {
    filePath: z.string().optional().describe('.mmdファイルの絶対パス（省略時はファイルピッカーモード）'),
    port: z.number().optional().default(3100).describe('使用するポート番号（デフォルト: 3100）'),
  },
  async ({ filePath, port }) => {
    // 既に起動済みならURLを返す
    if (activeViewer) {
      return {
        content: [{ type: 'text' as const, text: `ビューワーは既に起動中です: ${activeViewer.url}` }],
      };
    }

    let diagramPath: string | null = null;
    let baseDir: string;

    if (filePath) {
      diagramPath = resolve(filePath);
      if (!existsSync(diagramPath)) {
        return { content: [{ type: 'text' as const, text: `Error: ファイルが見つかりません: ${diagramPath}` }], isError: true };
      }
      baseDir = dirname(diagramPath);
    } else {
      baseDir = process.cwd();
    }

    try {
      const { url } = await startServer({ diagramPath, baseDir, port });
      activeViewer = { url, port };

      // ブラウザを自動で開く
      try {
        const open = (await import('open')).default;
        await open(url);
      } catch {
        // open に失敗しても続行
      }

      return { content: [{ type: 'text' as const, text: `ビューワーを起動しました: ${url}` }] };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error: サーバー起動に失敗: ${err.message}` }], isError: true };
    }
  },
);

// --- 起動 ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mermaid ER Viewer MCP server started (stdio)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
