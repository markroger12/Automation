import type { FaceBox } from './render-html';

export type GalleryPicture = {
  id: string;
  path: string;
  width: number;
  height: number;
  sha256: string;
  dhash: string;
  sharpness: number;
  faces: FaceBox[] | null;
  faceFp: string | null;
  source?: string;
  soft?: boolean;
  watermark?: boolean;
  collage?: boolean;
  alt?: string;
  dropped?: string;
};

export function hammingHex(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Exact copies (sha256), near copies (dHash ≤ 10 bits) and cropped copies (face-area fingerprint ≤ 12 bits with
 * 2+ faces, ≤ 6 with one face). The larger picture of a pair is kept.
 */
export function dedupePictures(pics: GalleryPicture[]): GalleryPicture[] {
  const sorted = [...pics].sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: GalleryPicture[] = [];
  for (const p of sorted) {
    let reason: string | null = null;
    for (const k of kept) {
      if (k.sha256 === p.sha256) reason = `exact copy of ${k.id}`;
      else if (hammingHex(k.dhash, p.dhash) <= 10) reason = `near copy of ${k.id}`;
      else if (k.faceFp && p.faceFp) {
        const many = (k.faces?.length ?? 0) >= 2 && (p.faces?.length ?? 0) >= 2;
        if (hammingHex(k.faceFp, p.faceFp) <= (many ? 12 : 6)) reason = `cropped copy of ${k.id}`;
      }
      if (reason) break;
    }
    if (reason) p.dropped = reason;
    else kept.push(p);
  }
  return pics.map((p) => p);
}

/** Soft = Laplacian variance below 0.4× the gallery median (only with 3+ pictures). */
export function markSoft(pics: GalleryPicture[]): void {
  const live = pics.filter((p) => !p.dropped);
  if (live.length < 3) return;
  const sorted = live.map((p) => p.sharpness).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  for (const p of live) p.soft = p.sharpness < 0.4 * median;
}

function largestFace(p: GalleryPicture): number {
  return p.faces?.length ? Math.max(...p.faces.map((f) => f.h)) : 0;
}

/** Faces first (by the largest face's height), then pictures without faces, soft pictures last. */
export function orderPictures(pics: GalleryPicture[]): GalleryPicture[] {
  const live = pics.filter((p) => !p.dropped);
  const group = (p: GalleryPicture) => (p.soft ? 2 : largestFace(p) > 0 ? 0 : 1);
  return [...live].sort((a, b) => group(a) - group(b) || largestFace(b) - largestFace(a) || b.width * b.height - a.width * a.height);
}

/** After the photo check: clean photos first, then watermarked, then collages (stable). */
export function orderAfterCheck(pics: GalleryPicture[]): GalleryPicture[] {
  const rank = (p: GalleryPicture) => (p.collage ? 2 : p.watermark ? 1 : 0);
  return pics.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

export type PhotoVerdict = { watermark: boolean; collage: boolean; alt: string };

/** "N: watermark=yes|no | collage=yes|no | alt=…" lines. */
export function parsePhotoCheck(text: string, count: number): Map<number, PhotoVerdict> {
  const out = new Map<number, PhotoVerdict>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*/g, '').trim();
    const m = /^(?:photo\s*|foto\s*|#)?(\d{1,2})\s*[:.)-]\s*(.*)$/i.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > count) continue;
    const rest = m[2]!;
    const wm = /watermark\s*=\s*(yes|no|ja|nein)/i.exec(rest)?.[1];
    const co = /collage\s*=\s*(yes|no|ja|nein)/i.exec(rest)?.[1];
    const alt = /alt\s*=\s*(.+?)\s*$/i.exec(rest)?.[1] ?? '';
    if (!wm && !co) continue;
    out.set(n, { watermark: /^(yes|ja)$/i.test(wm ?? 'no'), collage: /^(yes|ja)$/i.test(co ?? 'no'), alt: alt.replace(/^["']|["']$/g, '').trim() });
  }
  return out;
}

/** "<Keyword> – <description>", at most 125 characters. */
export function altText(keyword: string, description: string | undefined): string {
  const d = (description ?? '').replace(/\s+/g, ' ').replace(/[.]+$/, '').trim();
  const full = d ? `${keyword} – ${d}` : keyword;
  if (full.length <= 125) return full;
  const cut = full.slice(0, 125);
  return cut.slice(0, cut.lastIndexOf(' ') > 60 ? cut.lastIndexOf(' ') : 125).trim();
}

export type Assignment = { featured: GalleryPicture[]; body: GalleryPicture[]; leftOut: number };

/** Each picture in one design only: featured takes `featuredSlots` pictures, body images one non-collage each. */
export function assignPictures(ordered: GalleryPicture[], featuredSlots: number, bodyCount = 2): Assignment {
  const pool = [...ordered];
  const featured: GalleryPicture[] = [];
  // Prefer non-collage pictures for the featured image too; collages only when nothing else is left.
  for (const p of [...pool.filter((x) => !x.collage), ...pool.filter((x) => x.collage)]) {
    if (featured.length >= featuredSlots) break;
    featured.push(p);
  }
  const rest = pool.filter((p) => !featured.includes(p) && !p.collage);
  const body = rest.slice(0, bodyCount);
  return { featured, body, leftOut: bodyCount - body.length };
}
