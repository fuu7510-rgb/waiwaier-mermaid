import { resolve, sep } from 'path';

export function assertWithinBase(targetPath: string, baseDir: string): void {
  let resolved = resolve(targetPath);
  let base = resolve(baseDir);
  if (process.platform === 'win32') {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1);
    base = base.charAt(0).toUpperCase() + base.slice(1);
  }
  if (!resolved.startsWith(base + sep) && resolved !== base) {
    throw new Error('Path traversal detected');
  }
}
