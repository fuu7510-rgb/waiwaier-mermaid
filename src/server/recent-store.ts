import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface RecentEntry {
  path: string;
  openedAt: string;
}

const MAX_RECENT = 20;
const CONFIG_DIR = join(homedir(), '.mermaid-er-viewer');
const RECENT_FILE = join(CONFIG_DIR, 'recent.json');

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadRecentFiles(): string[] {
  if (!existsSync(RECENT_FILE)) return [];
  try {
    const raw = readFileSync(RECENT_FILE, 'utf-8');
    const entries: RecentEntry[] = JSON.parse(raw);
    // Filter to only files that still exist
    return entries
      .map((e) => e.path)
      .filter((p) => existsSync(p));
  } catch {
    return [];
  }
}

export function addToRecent(filePath: string): void {
  ensureConfigDir();
  let entries: RecentEntry[] = [];
  if (existsSync(RECENT_FILE)) {
    try {
      entries = JSON.parse(readFileSync(RECENT_FILE, 'utf-8'));
    } catch {
      entries = [];
    }
  }
  // Remove existing entry for the same path
  entries = entries.filter((e) => e.path !== filePath);
  // Add to front
  entries.unshift({ path: filePath, openedAt: new Date().toISOString() });
  // Trim to max
  entries = entries.slice(0, MAX_RECENT);
  writeFileSync(RECENT_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}
