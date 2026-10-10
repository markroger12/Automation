import fs from 'node:fs/promises';
import path from 'node:path';
import type { Website } from '@prisma/client';
import { DATA_DIR, LOGOS_DIR, MEDIA_DIR, ensureDir, safeJoin } from '@/server/env';
import { strongestColour } from './analyze';

export async function loadLogo(website: Pick<Website, 'logoFile'> | null | undefined): Promise<Buffer | null> {
  if (!website?.logoFile) return null;
  const file = safeJoin(LOGOS_DIR, website.logoFile);
  if (!file) return null;
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

/** Line colour: the website's colour, else the logo's strongest colour. */
export async function accentColour(website: Pick<Website, 'accentColour' | 'logoFile'> | null | undefined, logo?: Buffer | null): Promise<string> {
  if (website?.accentColour && /^#[0-9a-f]{3,8}$/i.test(website.accentColour)) return website.accentColour;
  const l = logo ?? (await loadLogo(website));
  return l ? strongestColour(l).catch(() => '#2753e6') : '#2753e6';
}

/** data/media/tasks/<taskId>/… (relative path stored on the stage, absolute path for writing). */
export function taskMedia(taskId: string, file: string): { rel: string; abs: string } {
  const dir = ensureDir(path.join(MEDIA_DIR, 'tasks', taskId));
  return { rel: path.join('media', 'tasks', taskId, file).replace(/\\/g, '/'), abs: path.join(dir, file) };
}

export async function readData(rel: string): Promise<Buffer> {
  const abs = safeJoin(DATA_DIR, rel);
  if (!abs) throw new Error(`Bad path ${rel}`);
  return fs.readFile(abs);
}
