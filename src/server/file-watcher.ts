import chokidar from 'chokidar';

export type FileChangeCallback = () => void;

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private callbacks: FileChangeCallback[] = [];

  constructor(private filePath: string) {}

  start(): void {
    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on('change', () => {
      this.callbacks.forEach((cb) => cb());
    });
  }

  onChange(callback: FileChangeCallback): void {
    this.callbacks.push(callback);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
