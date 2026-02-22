import { resolve } from 'path';
import { existsSync } from 'fs';
import { startServer } from './server.js';

function printUsage(): void {
  console.log('Usage: mermaid-er-viewer <file.mmd> [--port <number>]');
  console.log('');
  console.log('Options:');
  console.log('  --port <number>  Port number (default: 3000)');
  console.log('  --no-open        Do not open browser automatically');
  console.log('  --help           Show this help');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let filePath: string | null = null;
  let port = 3000;
  let shouldOpen = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--no-open') {
      shouldOpen = false;
    } else if (!args[i].startsWith('-')) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error('Error: No .mmd file specified.');
    printUsage();
    process.exit(1);
  }

  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    console.error(`Error: File not found: ${absolutePath}`);
    process.exit(1);
  }

  const { url } = await startServer({ diagramPath: absolutePath, port });

  if (shouldOpen) {
    try {
      const open = (await import('open')).default;
      await open(url);
    } catch {
      // If open fails, just print the URL
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
