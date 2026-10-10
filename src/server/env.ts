import fs from 'node:fs';
import path from 'node:path';

/** Project root. Both the dashboard and the worker are started from the project folder. */
export const ROOT_DIR = process.cwd();

let envLoaded = false;

/** Minimal .env loader (no dependency). Values already in process.env win. */
export function loadEnv(file = path.join(ROOT_DIR, '.env')): void {
  if (envLoaded) return;
  envLoaded = true;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

loadEnv();

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
export const CHATGPT_CHROME_DIR = path.join(DATA_DIR, 'chatgpt-chrome');
export const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const LOGOS_DIR = path.join(DATA_DIR, 'logos');
export const TOOLS_DIR = path.join(DATA_DIR, 'tools');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolves a relative SQLite URL (file:../data/app.db) against the prisma folder, like the Prisma CLI does. */
export function resolveDatabaseUrl(url = process.env.DATABASE_URL || 'file:../data/app.db'): string {
  if (!url.startsWith('file:')) return url;
  const rest = url.slice('file:'.length);
  const [p, query] = rest.split('?');
  if (!p || path.isAbsolute(p)) return url;
  const abs = path.resolve(ROOT_DIR, 'prisma', p).replace(/\\/g, '/');
  // socket_timeout = seconds to wait for a SQLite lock (the dashboard and the worker share the file).
  const params = new URLSearchParams(query ?? '');
  if (!params.has('socket_timeout')) params.set('socket_timeout', '20');
  return `file:${abs}?${params.toString()}`;
}

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** Rejects path traversal: returns the absolute path only when it stays inside `base`. */
export function safeJoin(base: string, relative: string): string | null {
  const resolved = path.resolve(base, relative);
  const baseResolved = path.resolve(base);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) return null;
  return resolved;
}
