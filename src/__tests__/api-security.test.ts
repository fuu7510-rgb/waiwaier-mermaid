import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/server.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('API Security', () => {
  let app: ReturnType<typeof createApp>;
  let baseDir: string;

  beforeAll(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'api-security-test-'));
    writeFileSync(join(baseDir, 'test.mmd'), 'erDiagram\n');
    mkdirSync(join(baseDir, 'subdir'));
    writeFileSync(join(baseDir, 'subdir', 'nested.mmd'), 'erDiagram\n');
    app = createApp(baseDir);
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('GET /api/browse', () => {
    it('baseDir内のパスを許可する', async () => {
      const res = await request(app).get('/api/browse');
      expect(res.status).toBe(200);
      expect(res.body.currentPath).toBeTruthy();
      expect(res.body.files).toBeInstanceOf(Array);
    });

    it('サブディレクトリのブラウズを許可する', async () => {
      const subdir = join(baseDir, 'subdir');
      const res = await request(app)
        .get(`/api/browse?path=${encodeURIComponent(subdir)}`);
      expect(res.status).toBe(200);
      expect(res.body.files.length).toBe(1);
      expect(res.body.files[0].name).toBe('nested.mmd');
    });

    it('baseDir外のパスを403で拒否する', async () => {
      const outsidePath = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
      const res = await request(app)
        .get(`/api/browse?path=${encodeURIComponent(outsidePath)}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });

    it('../による脱出を403で拒否する', async () => {
      const escapePath = join(baseDir, '..');
      const res = await request(app)
        .get(`/api/browse?path=${encodeURIComponent(escapePath)}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });

    it('../../による深い脱出を403で拒否する', async () => {
      const escapePath = join(baseDir, 'subdir', '..', '..');
      const res = await request(app)
        .get(`/api/browse?path=${encodeURIComponent(escapePath)}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });
  });

  describe('POST /api/open', () => {
    it('baseDir外のファイルを403で拒否する', async () => {
      const outsideFile = process.platform === 'win32'
        ? 'C:\\Windows\\evil.mmd'
        : '/etc/passwd.mmd';
      const res = await request(app)
        .post('/api/open')
        .send({ file: outsideFile });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });

    it('../による脱出を403で拒否する', async () => {
      const escapePath = join(baseDir, '..', 'evil.mmd');
      const res = await request(app)
        .post('/api/open')
        .send({ file: escapePath });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });

    it('fileが未指定の場合は400で拒否する', async () => {
      const res = await request(app)
        .post('/api/open')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('file is required');
    });
  });

  describe('GET /api/status', () => {
    it('初期状態ではアクティブファイルなし', async () => {
      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body.hasActiveFile).toBe(false);
      expect(res.body.activeFile).toBeNull();
    });
  });
});
