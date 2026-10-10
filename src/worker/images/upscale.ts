import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { CACHE_DIR, TOOLS_DIR, ensureDir } from '@/server/env';

/** Upscayl's upscayl-bin with the remacri-4x model (data/tools/upscayl). Missing tool = keep the original. */
export const UPSCAYL_DIR = path.join(TOOLS_DIR, 'upscayl');
const BIN = path.join(UPSCAYL_DIR, process.platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin');
const MODELS = path.join(UPSCAYL_DIR, 'models');

export function upscalerAvailable(): boolean {
  return fs.existsSync(BIN) && fs.existsSync(path.join(MODELS, 'remacri-4x.param')) && fs.existsSync(path.join(MODELS, 'remacri-4x.bin'));
}

let chain: Promise<unknown> = Promise.resolve();

/** One picture at a time, 5-minute timeout, cached by content hash. */
export function upscale(buf: Buffer): Promise<Buffer | null> {
  const run = chain.then(() => doUpscale(buf));
  chain = run.catch(() => undefined);
  return run;
}

async function doUpscale(buf: Buffer): Promise<Buffer | null> {
  if (!upscalerAvailable()) return null;
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const cacheDir = ensureDir(path.join(CACHE_DIR, 'upscale'));
  const cached = path.join(cacheDir, `${hash}.png`);
  if (fs.existsSync(cached)) return fsp.readFile(cached);
  const tmpIn = path.join(cacheDir, `${hash}-in.png`);
  const sharp = (await import('sharp')).default;
  await fsp.writeFile(tmpIn, await sharp(buf).rotate().png().toBuffer());
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(BIN, ['-i', tmpIn, '-o', cached, '-s', '4', '-m', MODELS, '-n', 'remacri-4x', '-f', 'png'], { timeout: 5 * 60_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    });
    return fs.existsSync(cached) ? await fsp.readFile(cached) : null;
  } catch {
    return null;
  } finally {
    await fsp.rm(tmpIn, { force: true }).catch(() => undefined);
  }
}
