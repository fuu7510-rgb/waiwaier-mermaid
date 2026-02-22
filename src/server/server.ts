import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseERDiagram } from '../parser/er-parser.js';
import { LayoutStore } from './layout-store.js';
import { FileWatcher } from './file-watcher.js';
import type { ERDiagramJSON, LayoutData } from '../parser/types.js';

// __dirname is provided by esbuild banner
declare const __dirname: string;

export interface ServerOptions {
  diagramPath: string;
  port: number;
}

export function startServer(options: ServerOptions): Promise<{ url: string }> {
  const { diagramPath, port } = options;
  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const layoutStore = new LayoutStore(diagramPath);
  const fileWatcher = new FileWatcher(diagramPath);

  // Handle WebSocket upgrade manually so it doesn't bind to the server before listen
  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  app.use(express.json());

  // Serve static client files
  // __dirname is dist/server, client is at dist/client
  const clientDir = join(__dirname, '..', 'client');
  app.use(express.static(clientDir));

  // GET /api/diagram - Return parsed ER diagram as JSON
  app.get('/api/diagram', (_req, res) => {
    try {
      const source = readFileSync(diagramPath, 'utf-8');
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
    try {
      const source = readFileSync(diagramPath, 'utf-8');
      let layout = layoutStore.load();
      if (!layout) {
        layout = layoutStore.createDefault(source);
      }
      res.json(layout);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/layout - Save layout data
  app.put('/api/layout', (req, res) => {
    try {
      const layout = req.body as LayoutData;
      layoutStore.save(layout);
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

  // File watcher
  fileWatcher.onChange(() => {
    broadcast({ type: 'file-changed' });
  });
  fileWatcher.start();

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
      console.log(`Watching: ${diagramPath}`);
      console.log(`Layout:   ${layoutStore.getLayoutPath()}`);
      resolve({ url });
    });
  });
}
