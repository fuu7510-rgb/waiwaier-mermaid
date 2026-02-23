import { fetchStatus, browsePath, openFile, fetchRecent } from './picker-api.js';

let currentPath = '';

function getBaseName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function renderBreadcrumb(path: string): void {
  const nav = document.getElementById('breadcrumb')!;
  nav.innerHTML = '';

  // Normalize path separators for display
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  // On Windows, the first part might be a drive letter like "C:"
  // Reconstruct paths step by step
  let accumulated = '';
  const isWindows = /^[A-Za-z]:/.test(path);

  for (let i = 0; i < parts.length; i++) {
    if (i === 0 && isWindows) {
      accumulated = parts[i];
    } else if (i === 0 && !isWindows) {
      accumulated = '/' + parts[i];
    } else {
      accumulated += '/' + parts[i];
    }

    if (i < parts.length - 1) {
      // Clickable breadcrumb
      const span = document.createElement('span');
      span.className = 'breadcrumb-item';
      span.textContent = parts[i];
      const navPath = accumulated;
      span.addEventListener('click', () => navigateTo(navPath));
      nav.appendChild(span);

      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      nav.appendChild(sep);
    } else {
      // Current directory (not clickable)
      const span = document.createElement('span');
      span.className = 'breadcrumb-current';
      span.textContent = parts[i];
      nav.appendChild(span);
    }
  }
}

async function loadRecent(): Promise<void> {
  try {
    const files = await fetchRecent();
    const section = document.getElementById('recent-section')!;
    const list = document.getElementById('recent-list')!;

    if (files.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    list.innerHTML = '';

    for (const filePath of files) {
      const li = document.createElement('li');
      li.className = 'recent-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-name';
      nameSpan.textContent = getBaseName(filePath);

      const pathSpan = document.createElement('span');
      pathSpan.className = 'file-path';
      pathSpan.textContent = filePath;

      li.appendChild(nameSpan);
      li.appendChild(pathSpan);
      li.addEventListener('click', () => handleOpenFile(filePath));
      list.appendChild(li);
    }
  } catch {
    // Silently ignore recent files errors
  }
}

async function navigateTo(path?: string): Promise<void> {
  try {
    const data = await browsePath(path);
    currentPath = data.currentPath;
    renderBreadcrumb(currentPath);

    const dirList = document.getElementById('dir-list')!;
    const fileList = document.getElementById('file-list')!;
    const emptyMsg = document.getElementById('empty-message')!;

    dirList.innerHTML = '';
    fileList.innerHTML = '';

    // Parent directory
    if (data.parentPath) {
      const li = document.createElement('li');
      li.className = 'dir-item';

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '\u{1F4C1}';

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = '..';

      li.appendChild(icon);
      li.appendChild(name);
      li.addEventListener('click', () => navigateTo(data.parentPath!));
      dirList.appendChild(li);
    }

    // Directories
    for (const dir of data.directories) {
      const li = document.createElement('li');
      li.className = 'dir-item';

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '\u{1F4C1}';

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = dir.name;

      li.appendChild(icon);
      li.appendChild(name);
      li.addEventListener('click', () => navigateTo(dir.path));
      dirList.appendChild(li);
    }

    // Files
    for (const file of data.files) {
      const li = document.createElement('li');
      li.className = 'mmd-item';

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '\u{1F4C4}';

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = file.name;

      li.appendChild(icon);
      li.appendChild(name);
      li.addEventListener('click', () => handleOpenFile(file.path));
      fileList.appendChild(li);
    }

    // Show empty message if no dirs and no files
    if (data.directories.length === 0 && data.files.length === 0) {
      emptyMsg.style.display = '';
    } else {
      emptyMsg.style.display = 'none';
    }
  } catch (err: any) {
    console.error('Browse error:', err);
  }
}

async function handleOpenFile(filePath: string): Promise<void> {
  try {
    await openFile(filePath);
    window.location.href = '/';
  } catch (err: any) {
    console.error('Open error:', err);
    alert('Failed to open file: ' + err.message);
  }
}

async function init(): Promise<void> {
  // Check if a file is already active
  try {
    const status = await fetchStatus();
    if (status.hasActiveFile) {
      window.location.href = '/';
      return;
    }
  } catch {
    // Continue to picker
  }

  await Promise.all([loadRecent(), navigateTo()]);
}

document.addEventListener('DOMContentLoaded', init);
