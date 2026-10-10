import crypto from 'node:crypto';
import sharp from 'sharp';
import type { FaceBox } from '@/core/render-html';

/** Image facts used to de-duplicate and order pictures. Always pass buffers to sharp (Windows file locks). */
export type ImageFacts = { width: number; height: number; sha256: string; dhash: string; sharpness: number };

export async function dHash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (data[y * 9 + x]! > data[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Variance of the Laplacian on a ≤512 px greyscale copy: low = soft/blurry. */
export async function laplacianVariance(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).rotate().greyscale().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = data[i - w]! + data[i + w]! + data[i - 1]! + data[i + 1]! - 4 * data[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 100) / 100;
}

export async function imageFacts(buf: Buffer): Promise<ImageFacts> {
  const meta = await sharp(buf).rotate().metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  return {
    width: (swap ? meta.height : meta.width) ?? 0,
    height: (swap ? meta.width : meta.height) ?? 0,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    dhash: await dHash(buf),
    sharpness: await laplacianVariance(buf),
  };
}

/** Fingerprint of the face area (union of faces, expanded) — finds cropped copies of the same photo. */
export async function faceFingerprint(buf: Buffer, faces: FaceBox[], width: number, height: number): Promise<string | null> {
  if (!faces.length) return null;
  const x1 = Math.min(...faces.map((f) => f.x));
  const y1 = Math.min(...faces.map((f) => f.y));
  const x2 = Math.max(...faces.map((f) => f.x + f.w));
  const y2 = Math.max(...faces.map((f) => f.y + f.h));
  const padX = (x2 - x1) * 0.3;
  const padY = (y2 - y1) * 0.3;
  const left = Math.max(0, Math.floor(x1 - padX));
  const top = Math.max(0, Math.floor(y1 - padY));
  const right = Math.min(width, Math.ceil(x2 + padX));
  const bottom = Math.min(height, Math.ceil(y2 + padY));
  if (right - left < 8 || bottom - top < 8) return null;
  const crop = await sharp(buf).rotate().extract({ left, top, width: right - left, height: bottom - top }).toBuffer();
  return dHash(crop);
}

/** JPEG copy no larger than `max` px (for ChatGPT attachments and uploads). */
export async function toJpeg(buf: Buffer, max = 2400, quality = 90): Promise<Buffer> {
  return sharp(buf).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/** The logo's strongest colour (most saturated, not near white/black) — the default line colour. */
export async function strongestColour(buf: Buffer): Promise<string> {
  const { data, info } = await sharp(buf).ensureAlpha().resize(64, 64, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { r: number; g: number; b: number; n: number; sat: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (max > 240 && sat < 0.1) continue;
    if (max < 25) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, sat };
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.n++;
    buckets.set(key, cur);
  }
  let best: { r: number; g: number; b: number; n: number; sat: number } | null = null;
  for (const v of buckets.values()) {
    if (v.n < 3) continue;
    if (!best || v.sat * Math.sqrt(v.n) > best.sat * Math.sqrt(best.n)) best = v;
  }
  if (!best) return '#2753e6';
  const hex = (x: number) => Math.round(x / best!.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}
