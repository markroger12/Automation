import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { TOOLS_DIR } from '@/server/env';
import type { FaceBox } from '@/core/render-html';
import { withRenderPage } from './render';

/**
 * Face locations with MediaPipe BlazeFace (tasks-vision) running in headless Chrome from local files in
 * data/tools/mediapipe. Only locations are found, never identities. Missing files = null (old behaviour).
 */
export const MEDIAPIPE_DIR = path.join(TOOLS_DIR, 'mediapipe');
const FILES = ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'blaze_face_short_range.tflite'];

export function faceToolAvailable(): boolean {
  return FILES.every((f) => fs.existsSync(path.join(MEDIAPIPE_DIR, f)));
}

const HOST = 'https://bas-tools.local';
const TYPES: Record<string, string> = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.html': 'text/html' };

const PAGE = `<!doctype html><html><body><script type="module">
import { FaceDetector, FilesetResolver } from '${HOST}/vision_bundle.mjs';
const fileset = await FilesetResolver.forVisionTasks('${HOST}/wasm');
const detector = await FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: '${HOST}/blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
function iou(a, b) { const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / (a.w * a.h + b.w * b.h - i); }
window.detectFaces = async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight, boxes = [];
  const run = (sx, sy, sw, sh) => {
    const c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    for (const d of detector.detect(c).detections) { const b = d.boundingBox; boxes.push({ x: sx + b.originX, y: sy + b.originY, w: b.width, h: b.height, score: d.categories[0]?.score ?? 0 }); }
  };
  run(0, 0, W, H);
  for (const n of [2, 3]) { const tw = W / n * 1.2, th = H / n * 1.2; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) run(Math.min(W - tw, i * W / n), Math.min(H - th, j * H / n), Math.min(tw, W), Math.min(th, H)); }
  boxes.sort((a, b) => b.score - a.score);
  const keep = []; for (const b of boxes) if (b.w > 8 && keep.every((k) => iou(k, b) < 0.3 && !(b.x >= k.x && b.y >= k.y && b.x + b.w <= k.x + k.w && b.y + b.h <= k.y + k.h))) keep.push(b);
  return keep;
};
window.ready = true;
</script></body></html>`;

export async function detectFaces(images: Buffer[]): Promise<FaceBox[][] | null> {
  if (!faceToolAvailable() || !images.length) return null;
  return withRenderPage(async (page) => {
    await page.route(`${HOST}/**`, async (route) => {
      const rel = new URL(route.request().url()).pathname.replace(/^\/+/, '');
      if (rel === 'detect.html') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
      const file = path.join(MEDIAPIPE_DIR, rel);
      if (!file.startsWith(MEDIAPIPE_DIR) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.goto(`${HOST}/detect.html`);
    await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, null, { timeout: 60_000 });
    const out: FaceBox[][] = [];
    for (const buf of images) {
      const meta = await sharp(buf).rotate().metadata();
      const w = meta.width ?? 1;
      const scale = Math.min(1, 1600 / Math.max(w, meta.height ?? 1));
      const small = await sharp(buf).rotate().resize(Math.round(w * scale)).jpeg({ quality: 85 }).toBuffer();
      const boxes = await page.evaluate((src: string) => (window as unknown as { detectFaces: (s: string) => Promise<FaceBox[]> }).detectFaces(src), `data:image/jpeg;base64,${small.toString('base64')}`);
      out.push(boxes.map((b) => ({ x: b.x / scale, y: b.y / scale, w: b.w / scale, h: b.h / scale, score: b.score })));
    }
    return out;
  });
}
