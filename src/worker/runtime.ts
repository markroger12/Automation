import os from 'node:os';
import crypto from 'node:crypto';
import { getSettings } from '@/server/settings';
import type { Settings } from '@/lib/settings-schema';

export const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

let stopping = false;
const shutdownHooks: (() => Promise<void> | void)[] = [];

export function isStopping(): boolean {
  return stopping;
}

export function markStopping(): void {
  stopping = true;
}

export function onShutdown(fn: () => Promise<void> | void): void {
  shutdownHooks.push(fn);
}

export async function runShutdownHooks(): Promise<void> {
  for (const fn of shutdownHooks.reverse()) {
    try {
      await Promise.race([fn(), sleep(8000)]);
    } catch (err) {
      console.error('Shutdown hook failed', err);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

let settingsCache: { value: Settings; at: number } | null = null;

/** Settings, cached for a few seconds so busy loops do not hammer SQLite. */
export async function currentSettings(maxAgeMs = 5000): Promise<Settings> {
  if (settingsCache && Date.now() - settingsCache.at < maxAgeMs) return settingsCache.value;
  const value = await getSettings();
  settingsCache = { value, at: Date.now() };
  return value;
}

export function isPidAlive(pid: number): boolean {
  if (!pid || pid === process.pid) return pid === process.pid;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
