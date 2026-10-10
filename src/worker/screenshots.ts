import path from 'node:path';
import fs from 'node:fs/promises';
import type { Page } from 'playwright';
import { SCREENSHOTS_DIR, ensureDir } from '@/server/env';
import { currentSettings } from './runtime';

/**
 * Saves a failure screenshot (chatgpt-error, wordpress-error, rankmath-error, *-login-required) and returns its
 * path relative to data/screenshots, or null when screenshots are off or the page is gone.
 */
export async function captureScreenshot(page: Page | null | undefined, name: string, taskId?: string | null): Promise<string | null> {
  if (!page || page.isClosed()) return null;
  if (!(await currentSettings()).captureScreenshots) return null;
  const day = new Date().toISOString().slice(0, 10);
  const dir = ensureDir(path.join(SCREENSHOTS_DIR, day));
  const file = `${(taskId ?? 'system').slice(-10)}-${name.replace(/[^a-z0-9-]/gi, '')}-${Date.now()}.png`;
  try {
    const buf = await page.screenshot({ fullPage: false, timeout: 10_000 });
    await fs.writeFile(path.join(dir, file), buf);
    return `${day}/${file}`;
  } catch {
    return null;
  }
}

/** Saves an image the extension or a tool produced (used for ChatGPT debug captures). */
export async function saveScreenshotBuffer(buf: Buffer, name: string, taskId?: string | null): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const dir = ensureDir(path.join(SCREENSHOTS_DIR, day));
  const file = `${(taskId ?? 'system').slice(-10)}-${name.replace(/[^a-z0-9-]/gi, '')}-${Date.now()}.png`;
  await fs.writeFile(path.join(dir, file), buf);
  return `${day}/${file}`;
}
