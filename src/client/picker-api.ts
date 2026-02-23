export interface StatusResponse {
  hasActiveFile: boolean;
  activeFile: string | null;
}

export interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  directories: { name: string; path: string }[];
  files: { name: string; path: string }[];
}

export interface RecentResponse {
  files: string[];
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

export async function browsePath(path?: string): Promise<BrowseResponse> {
  const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to browse directory');
  return res.json();
}

export async function openFile(file: string): Promise<void> {
  const res = await fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to open file');
  }
}

export async function closeFile(): Promise<void> {
  const res = await fetch('/api/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to close file');
}

export async function fetchRecent(): Promise<string[]> {
  const res = await fetch('/api/recent');
  if (!res.ok) throw new Error('Failed to fetch recent files');
  const data: RecentResponse = await res.json();
  return data.files;
}
