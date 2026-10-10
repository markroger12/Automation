import fs from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';
import { prisma } from '@/server/db';
import { PROFILES_DIR, ensureDir, safeJoin } from '@/server/env';
import { ConfigError } from '@/server/errors';
import { launchPersistent, type LaunchMode } from './launch';
import { currentSettings, onShutdown } from '../runtime';

type Entry = { context: BrowserContext; mode: LaunchMode; lastUsed: number };

const contexts = new Map<string, Entry>();
const locks = new Map<string, Promise<unknown>>();
const IDLE_CLOSE_MS = 3 * 60_000;

/** Serialises everything that touches one profile folder (Chrome locks a profile to one process). */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => next);
  locks.set(key, chained);
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

export async function profileDir(profileId: string): Promise<string> {
  const profile = await prisma.browserProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new ConfigError('The browser profile of this website was deleted. Open Websites and log in again.');
  const dir = safeJoin(PROFILES_DIR, profile.directory);
  if (!dir) throw new ConfigError('Invalid profile folder name.');
  ensureDir(dir);
  return dir;
}

async function closeEntry(profileId: string): Promise<void> {
  const entry = contexts.get(profileId);
  if (!entry) return;
  contexts.delete(profileId);
  await entry.context.close().catch(() => undefined);
}

async function getContext(profileId: string, mode: LaunchMode): Promise<BrowserContext> {
  const existing = contexts.get(profileId);
  if (existing && existing.mode === mode) {
    try {
      existing.context.pages(); // throws when the browser is gone
      if (existing.context.browser()?.isConnected() !== false) return existing.context;
    } catch {
      // fall through and relaunch
    }
  }
  await closeEntry(profileId);
  const context = await launchPersistent(await profileDir(profileId), mode);
  const entry: Entry = { context, mode, lastUsed: Date.now() };
  contexts.set(profileId, entry);
  context.on('close', () => {
    if (contexts.get(profileId) === entry) contexts.delete(profileId);
  });
  return context;
}

/** Runs `fn` with the profile's browser context (headless/background/visible from Settings, or forced). */
export async function withProfile<T>(profileId: string, fn: (context: BrowserContext) => Promise<T>, opts: { mode?: LaunchMode } = {}): Promise<T> {
  return withLock(profileId, async () => {
    const mode = opts.mode ?? (await currentSettings()).browserMode;
    const context = await getContext(profileId, mode);
    const entry = contexts.get(profileId);
    try {
      return await fn(context);
    } finally {
      if (entry) entry.lastUsed = Date.now();
    }
  });
}

/** Opens a new page in the profile and closes it afterwards. */
export async function withProfilePage<T>(profileId: string, fn: (page: Page, context: BrowserContext) => Promise<T>, opts: { mode?: LaunchMode } = {}): Promise<T> {
  return withProfile(
    profileId,
    async (context) => {
      const page = await context.newPage();
      try {
        return await fn(page, context);
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    opts,
  );
}

/**
 * A visible window the person uses by hand (login, "Open Browser"). Resolves when they close it
 * (that saves the cookies) or after `timeoutMs`.
 */
export async function withVisibleWindow(profileId: string, url: string, timeoutMs: number, onOpen?: (page: Page) => Promise<void>): Promise<'closed' | 'timeout'> {
  return withLock(profileId, async () => {
    await closeEntry(profileId);
    const context = await launchPersistent(await profileDir(profileId), 'visible');
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: 'commit', timeout: 60_000 }).catch(() => undefined);
    if (onOpen) await onOpen(page).catch(() => undefined);
    const outcome = await new Promise<'closed' | 'timeout'>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs);
      context.on('close', () => {
        clearTimeout(timer);
        resolve('closed');
      });
      // Closing the last tab also counts as done.
      context.on('page', (p) => p.on('close', () => context.pages().length === 0 && context.close().catch(() => undefined)));
      page.on('close', () => context.pages().length === 0 && context.close().catch(() => undefined));
    });
    await context.close().catch(() => undefined);
    return outcome;
  });
}

export async function clearProfileCookies(profileId: string): Promise<void> {
  await withProfile(profileId, async (context) => {
    await context.clearCookies();
  }, { mode: 'headless' });
  await withLock(profileId, () => closeEntry(profileId));
}

export async function deleteProfileFolder(profileId: string): Promise<void> {
  await withLock(profileId, async () => {
    await closeEntry(profileId);
    const dir = await profileDir(profileId);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  });
}

/** Closes idle profile browsers so they do not hold memory and folder locks. */
export async function closeIdleProfiles(): Promise<void> {
  const now = Date.now();
  for (const [id, entry] of contexts) {
    if (now - entry.lastUsed > IDLE_CLOSE_MS && !locks.has(id)) await closeEntry(id);
  }
}

onShutdown(async () => {
  await Promise.all([...contexts.keys()].map((id) => closeEntry(id)));
});

export function newProfileDirectoryName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'site'}-${Math.random().toString(36).slice(2, 8)}`;
}
