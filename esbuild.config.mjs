import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build server
await esbuild.build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist/server',
  external: ['express', 'ws', 'chokidar', 'open'],
  banner: {
    js: `#!/usr/bin/env node
import { createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname_fn } from 'path';
const require = createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);
`.trim(),
  },
});

// Build client (viewer)
await esbuild.build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  outdir: 'dist/client',
  sourcemap: true,
});

// Build client (picker)
await esbuild.build({
  entryPoints: ['src/client/picker.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  outdir: 'dist/client',
  sourcemap: true,
});

// Copy static files
const clientDistDir = join(__dirname, 'dist', 'client');
if (!existsSync(clientDistDir)) {
  mkdirSync(clientDistDir, { recursive: true });
}
copyFileSync(
  join(__dirname, 'src', 'client', 'index.html'),
  join(clientDistDir, 'index.html')
);
copyFileSync(
  join(__dirname, 'src', 'client', 'styles.css'),
  join(clientDistDir, 'styles.css')
);
copyFileSync(
  join(__dirname, 'src', 'client', 'picker.html'),
  join(clientDistDir, 'picker.html')
);
copyFileSync(
  join(__dirname, 'src', 'client', 'picker.css'),
  join(clientDistDir, 'picker.css')
);

// Build MCP server
await esbuild.build({
  entryPoints: ['src/mcp-server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist/server',
  outbase: 'src',
  external: ['express', 'ws', 'chokidar', 'open', '@modelcontextprotocol/sdk', 'zod'],
  banner: {
    js: `#!/usr/bin/env node
import { createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname_fn } from 'path';
const require = createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);
`.trim(),
  },
});

console.log('Build complete.');
