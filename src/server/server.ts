import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { parseERDiagram } from '../parser/er-parser.js';
import { LayoutStore } from './layout-store.js';
import { FileWatcher } from './file-watcher.js';
import { loadRecentFiles, addToRecent } from './recent-store.js';
import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

// __dirname is provided by esbuild banner
declare const __dirname: string;

export interface ServerOptions {
  diagramPath: string | null;
  baseDir: string;
  port: number;
}

interface ServerState {
  diagramPath: string | null;
  layoutStore: LayoutStore | null;
  fileWatcher: FileWatcher | null;
}

export function startServer(options: ServerOptions): Promise<{ url: string }> {
  const { port, baseDir } = options;
  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const state: ServerState = {
    diagramPath: options.diagramPath,
    layoutStore: options.diagramPath ? new LayoutStore(options.diagramPath) : null,
    fileWatcher: null,
  };

  // Start file watcher if we have a diagram
  if (state.diagramPath) {
    state.fileWatcher = new FileWatcher(state.diagramPath);
    state.fileWatcher.onChange(() => {
      broadcast({ type: 'file-changed' });
    });
    state.fileWatcher.start();
    addToRecent(state.diagramPath);
  }

  // Handle WebSocket upgrade manually so it doesn't bind to the server before listen
  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  app.use(express.json());

  // Serve static client files (disable default index so we can route / ourselves)
  const clientDir = join(__dirname, '..', 'client');
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      if (!existsSync(filePath)) {
        res.status(400).json({ error: 'File not found' });
        return;
      }

      if (!filePath.endsWith('.mmd')) {
        res.status(400).json({ error: 'Only .mmd files are supported' });
        return;
      }

      // Stop existing watcher
      if (state.fileWatcher) {
        await state.fileWatcher.stop();
      }

      // Set up new state
      state.diagramPath = filePath;
      state.layoutStore = new LayoutStore(filePath);
      state.fileWatcher = new FileWatcher(filePath);
      state.fileWatcher.onChange(() => {
        broadcast({ type: 'file-changed' });
      });
      state.fileWatcher.start();
      addToRecent(filePath);

      broadcast({ type: 'file-switched', file: filePath });

      res.json({ ok: true, file: filePath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/close - Close active file and return to picker
  app.post('/api/close', async (_req, res) => {
    try {
      if (state.fileWatcher) {
        await state.fileWatcher.stop();
      }
      state.diagramPath = null;
      state.layoutStore = null;
      state.fileWatcher = null;

      broadcast({ type: 'file-closed' });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/layout - Save layout data
  app.put('/api/layout', (req, res) => {
    if (!state.layoutStore) {
      res.status(400).json({ error: 'No active file' });
      return;
    }
    try {
      const layout = req.body as LayoutData;
      state.layoutStore.save(layout);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // WebSocket: notify clients on file change
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  function broadcast(message: object): void {
    const data = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

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
      resolve({ url });
    });
  });
}
