import { describe, it, expect } from 'vitest';
import { assertWithinBase } from '../server/path-guard.js';

describe('assertWithinBase', () => {
  const baseDir = process.platform === 'win32'
    ? 'C:\\workspace\\project'
    : '/workspace/project';

  it('baseDir配下のパスを許可する', () => {
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\project\\src\\file.ts'
      : '/workspace/project/src/file.ts';
    expect(() => assertWithinBase(target, baseDir)).not.toThrow();
  });

  it('baseDir自体を許可する', () => {
    expect(() => assertWithinBase(baseDir, baseDir)).not.toThrow();
  });

  it('baseDir外のパスを拒否する', () => {
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\other'
      : '/workspace/other';
    expect(() => assertWithinBase(target, baseDir)).toThrow('Path traversal detected');
  });

  it('../による脱出を拒否する', () => {
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\project\\..\\other'
      : '/workspace/project/../other';
    expect(() => assertWithinBase(target, baseDir)).toThrow('Path traversal detected');
  });

  it('baseDirのプレフィックスだけ一致するパスを拒否する', () => {
    const target = process.platform === 'win32'
      ? 'C:\\workspace\\project-evil\\file.ts'
      : '/workspace/project-evil/file.ts';
    expect(() => assertWithinBase(target, baseDir)).toThrow('Path traversal detected');
  });
});
