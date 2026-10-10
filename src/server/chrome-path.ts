import fs from 'node:fs';
import path from 'node:path';

function firstExisting(paths: (string | undefined | null)[]): string | null {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // not there
    }
  }
  return null;
}

/** Finds the installed Google Chrome (CHROME_PATH wins). */
export function findChromeExecutable(): string | null {
  const env = process.env.CHROME_PATH?.trim();
  if (env) return firstExisting([env]);
  if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'];
    return firstExisting(roots.filter(Boolean).map((r) => path.join(r!, 'Google', 'Chrome', 'Application', 'chrome.exe')));
  }
  if (process.platform === 'darwin') {
    return firstExisting(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`]);
  }
  return firstExisting(['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']);
}

export function findEdgeExecutable(): string | null {
  if (process.platform === 'win32') {
    const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, 'C:\\Program Files (x86)', 'C:\\Program Files'];
    return firstExisting(roots.filter(Boolean).map((r) => path.join(r!, 'Microsoft', 'Edge', 'Application', 'msedge.exe')));
  }
  if (process.platform === 'darwin') return firstExisting(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
  return firstExisting(['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge']);
}
