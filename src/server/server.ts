import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { parseERDiagram } from '../parser/er-parser.js';
import { LayoutStore } from './layout-store.js';
import { FileWatcher } from './file-watcher.js';
import { loadRecentFiles, addToRecent } from './recent-store.js';
import { assertWithinBase } from './path-guard.js';
import type { ERDiagramJSON, LayoutData } from '../parser/types.js';
import { layoutDataSchema } from './layout-schema.js';

// __dirname is provided by esbuild banner
declare const __dirname: string;

export interface ServerOptions {
  diagramPath: string | null;
  baseDir: string;
  port: number;
}

export interface ServerState {
  diagramPath: string | null;
  layoutStore: LayoutStore | null;
  fileWatcher: FileWatcher | null;
  layoutWatcher: FileWatcher | null;
  lastWrittenHash: string | null;
}

interface CreateAppOptions {
  baseDir: string;
  state?: ServerState;
  clientDir?: string;
  broadcast?: (message: object) => void;
  startLayoutWatcher?: () => void;
}

/**
 * Express appを生成しルートを登録する。
 * supertestなどテスト用途でサーバー起動なしに利用できる。
 */
export function createApp(baseDirOrOptions: string | CreateAppOptions): express.Express {
  const opts: CreateAppOptions = typeof baseDirOrOptions === 'string'
    ? { baseDir: baseDirOrOptions }
    : baseDirOrOptions;

  const { baseDir } = opts;
  const state: ServerState = opts.state ?? {
    diagramPath: null,
    layoutStore: null,
    fileWatcher: null,
    layoutWatcher: null,
    lastWrittenHash: null,
  };
  const broadcast = opts.broadcast ?? (() => {});
  const startLayoutWatcher = opts.startLayoutWatcher ?? (() => {});

  const app = express();
  app.use(express.json());

  // Serve static client files only when clientDir is provided (skip in test)
  if (opts.clientDir) {
    const clientDir = opts.clientDir;
    app.use(express.static(clientDir, { index: false }));

    // GET / - Route to picker or viewer based on state
    app.get('/', (_req, res) => {
      if (state.diagramPath) {
        res.sendFile(join(clientDir, 'index.html'));
      } else {
        res.sendFile(join(clientDir, 'picker.html'));
      }
    });

    // GET /viewer - Always serve the viewer page
    app.get('/viewer', (_req, res) => {
      res.sendFile(join(clientDir, 'index.html'));
    });
  }

  // GET /api/status - Return current state
  app.get('/api/status', (_req, res) => {
    res.json({
      hasActiveFile: state.diagramPath !== null,
      activeFile: state.diagramPath,
    });
  });

  // GET /api/browse?path=... - Browse directories for .mmd files
  app.get('/api/browse', (req, res) => {
    try {
      const targetPath = req.query.path
        ? resolve(String(req.query.path))
        : baseDir;

      try {
        assertWithinBase(targetPath, baseDir);
      } catch {
        res.status(403).json({ error: 'Access denied: path outside base directory' });
        return;
      }

      if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
        res.status(400).json({ error: 'Invalid directory' });
        return;
      }

      const entries = readdirSync(targetPath);
      const dirs: { name: string; path: string }[] = [];
      const files: { name: string; path: string }[] = [];

      for (const entry of entries) {
        // Skip hidden files/directories
        if (entry.startsWith('.')) continue;

        const fullPath = join(targetPath, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            dirs.push({ name: entry, path: fullPath });
          } else if (entry.endsWith('.mmd')) {
            files.push({ name: entry, path: fullPath });
          }
        } catch {
          // Skip entries we can't stat
        }
      }

      // Sort alphabetically
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      // Parent directory (if not at root)
      const parentDir = dirname(targetPath);
      const hasParent = parentDir !== targetPath;

      res.json({
        currentPath: targetPath,
        parentPath: hasParent ? parentDir : null,
        directories: dirs,
        files,
      });
    } catch (err: unknown) {
      console.error('Browse error:', err);
      res.status(500).json({ error: 'Failed to browse directory' });
    }
  });

  // POST /api/open - Open a .mmd file
  app.post('/api/open', async (req, res) => {
    try {
      const { file } = req.body;
      if (!file || typeof file !== 'string') {
        res.status(400).json({ error: 'file is required' });
        return;
      }

      const filePath = resolve(file);

      try {
        assertWithinBase(filePath, baseDir);
      } catch {
        res.status(403).json({ error: 'Access denied: path outside base directory' });
        return;
      }

      if (!existsSync(filePath)) {
        res.status(400).json({ error: 'File not found' });
        return;
      }

      if (!filePath.endsWith('.mmd')) {
        res.status(400).json({ error: 'Only .mmd files are supported' });
        return;
      }

      // Stop existing watchers
      if (state.fileWatcher) {
        await state.fileWatcher.stop();
      }
      if (state.layoutWatcher) {
        await state.layoutWatcher.stop();
        state.layoutWatcher = null;
      }

      // Set up new state
      state.diagramPath = filePath;
      state.layoutStore = new LayoutStore(filePath);
      state.fileWatcher = new FileWatcher(filePath);
      state.fileWatcher.onChange(() => {
        broadcast({ type: 'file-changed' });
      });
      state.fileWatcher.start();
      startLayoutWatcher();
      addToRecent(filePath);

      broadcast({ type: 'file-switched', file: filePath });

      res.json({ ok: true, file: filePath });
    } catch (err: unknown) {
      console.error('Open error:', err);
      res.status(500).json({ error: 'Failed to open file' });
    }
  });

  // POST /api/close - Close active file and return to picker
  app.post('/api/close', async (_req, res) => {
    try {
      if (state.fileWatcher) {
        await state.fileWatcher.stop();
      }
      if (state.layoutWatcher) {
        await state.layoutWatcher.stop();
      }
      state.diagramPath = null;
      state.layoutStore = null;
      state.fileWatcher = null;
      state.layoutWatcher = null;

      broadcast({ type: 'file-closed' });
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('Close error:', err);
      res.status(500).json({ error: 'Failed to close file' });
    }
  });

  // GET /api/recent - Return recently opened files
  app.get('/api/recent', (_req, res) => {
    const files = loadRecentFiles();
    res.json({ files });
  });

  // GET /api/diagram - Return parsed ER diagram as JSON
  app.get('/api/diagram', (_req, res) => {
    if (!state.diagramPath) {
      res.status(400).json({ error: 'No active file' });
      return;
    }
    try {
      const source = readFileSync(state.diagramPath, 'utf-8');
      const diagram = parseERDiagram(source);
      const json: ERDiagramJSON = {
        entities: Object.fromEntries(diagram.entities),
        relationships: diagram.relationships,
      };
      res.json(json);
    } catch (err: unknown) {
      console.error('Diagram parse error:', err);
      res.status(500).json({ error: 'Failed to parse diagram' });
    }
  });

  // GET /api/layout - Return layout data
  app.get('/api/layout', (_req, res) => {
    if (!state.diagramPath || !state.layoutStore) {
      res.status(400).json({ error: 'No active file' });
      return;
    }
    try {
      const source = readFileSync(state.diagramPath, 'utf-8');
      let layout = state.layoutStore.load();
      if (!layout) {
        layout = state.layoutStore.createDefault(source);
      }
      res.json(layout);
    } catch (err: unknown) {
      console.error('Layout load error:', err);
      res.status(500).json({ error: 'Failed to load layout' });
    }
  });

  // PUT /api/layout - Save layout data
  app.put('/api/layout', (req, res) => {
    if (!state.layoutStore) {
      res.status(400).json({ error: 'No active file' });
      return;
    }
    try {
      const parsed = layoutDataSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid layout data', details: parsed.error.issues });
        return;
      }
      const layout = parsed.data as LayoutData;
      state.lastWrittenHash = state.layoutStore.saveAndGetHash(layout);
      // API経由の保存でもクライアントに通知する
      broadcast({ type: 'layout-changed' });
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('Layout save error:', err);
      res.status(500).json({ error: 'Failed to save layout' });
    }
  });

  return app;
}

export function startServer(options: ServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const { port, baseDir } = options;
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });

  const state: ServerState = {
    diagramPath: options.diagramPath,
    layoutStore: options.diagramPath ? new LayoutStore(options.diagramPath) : null,
    fileWatcher: null,
    layoutWatcher: null,
    lastWrittenHash: null,
  };

  function broadcast(message: object): void {
    const data = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  function startLayoutWatcher(): void {
    if (state.layoutWatcher) return;
    if (!state.layoutStore) return;
    state.layoutWatcher = new FileWatcher(state.layoutStore.getLayoutPath());
    state.layoutWatcher.onChange(() => {
      try {
        const content = readFileSync(state.layoutStore!.getLayoutPath(), 'utf-8');
        const currentHash = state.layoutStore!.computeHash(content);
        if (currentHash === state.lastWrittenHash) {
          state.lastWrittenHash = null;
          return;
        }
        broadcast({ type: 'layout-changed' });
      } catch {
        // File may be temporarily unavailable during atomic saves
      }
    });
    state.layoutWatcher.start();
  }

  // Start file watcher if we have a diagram
  if (state.diagramPath) {
    state.fileWatcher = new FileWatcher(state.diagramPath);
    state.fileWatcher.onChange(() => {
      broadcast({ type: 'file-changed' });
    });
    state.fileWatcher.start();
    startLayoutWatcher();
    addToRecent(state.diagramPath);
  }

  // Handle WebSocket upgrade manually so it doesn't bind to the server before listen
  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  const clientDir = join(__dirname, '..', 'client');
  const app = createApp({
    baseDir,
    state,
    clientDir,
    broadcast,
    startLayoutWatcher,
  });

  httpServer.on('request', app);

  // WebSocket: notify clients on file change
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Error: Port ${port} is already in use.`);
        console.error(`Try a different port: mermaid-er-viewer <file> --port ${port + 1}`);
        process.exit(1);
      }
      reject(err);
    });

    httpServer.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`Mermaid ER Viewer running at ${url}`);
      if (state.diagramPath) {
        console.log(`Watching: ${state.diagramPath}`);
        console.log(`Layout:   ${state.layoutStore!.getLayoutPath()}`);
      } else {
        console.log('Mode: File picker (no file specified)');
      }
      resolve({
        url,
        close: async () => {
          if (state.fileWatcher) await state.fileWatcher.stop();
          if (state.layoutWatcher) await state.layoutWatcher.stop();
          await new Promise<void>((res, rej) => httpServer.close((err) => err ? rej(err) : res()));
        },
      });
    });
  });
}
