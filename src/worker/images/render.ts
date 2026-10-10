import sharp from 'sharp';
import type { Browser, Page } from 'playwright';
import { buildDesignHtml, designFonts, type FaceBox } from '@/core/render-html';
import type { Design } from '@/core/image-design';
import { launchHeadless } from '../browser/launch';
import { onShutdown } from '../runtime';

let browser: Promise<Browser> | null = null;
let lastUsed = 0;
let users = 0;

/** One headless browser for rendering and face detection, closed after two idle minutes. */
export async function withRenderPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (!browser) {
    browser = launchHeadless();
    browser.catch(() => (browser = null));
  }
  const b = await browser;
  users++;
  const page = await b.newPage();
  try {
    return await fn(page);
  } finally {
    users--;
    lastUsed = Date.now();
    await page.close().catch(() => undefined);
  }
}

setInterval(() => {
  if (browser && users === 0 && Date.now() - lastUsed > 120_000) {
    const b = browser;
    browser = null;
    void b.then((x) => x.close()).catch(() => undefined);
  }
}, 30_000).unref();

onShutdown(async () => {
  if (browser) await (await browser).close().catch(() => undefined);
  browser = null;
});

export type RenderPicture = { buffer: Buffer; width: number; height: number; faces?: FaceBox[] };

function dataUrl(buf: Buffer, mime = 'image/jpeg'): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Renders a design as a 1920×1080 PNG screenshot in headless Chrome. */
export async function renderDesign(design: Design, input: { pictures: (RenderPicture | null)[]; logo: Buffer | null; vars?: Record<string, string> }): Promise<Buffer> {
  const pictures = await Promise.all(
    input.pictures.map(async (p) => {
      if (!p) return null;
      // Keep data URLs reasonable: pictures larger than 2× the canvas are scaled down first.
      const scale = Math.min(1, 3840 / Math.max(p.width, p.height));
      const buf = scale < 1 ? await sharp(p.buffer).rotate().resize(Math.round(p.width * scale)).jpeg({ quality: 92 }).toBuffer() : await sharp(p.buffer).rotate().jpeg({ quality: 95 }).toBuffer();
      const faces = p.faces?.map((f) => ({ x: f.x * scale, y: f.y * scale, w: f.w * scale, h: f.h * scale }));
      return { src: dataUrl(buf), width: Math.round(p.width * scale), height: Math.round(p.height * scale), faces };
    }),
  );
  const logo = input.logo ? dataUrl(await sharp(input.logo).png().toBuffer(), 'image/png') : null;
  const html = buildDesignHtml(design, { pictures, logo, vars: input.vars, fonts: designFonts(design) });
  return withRenderPage(async (page) => {
    await page.setViewportSize({ width: design.width, height: design.height });
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]);
      await Promise.all(Array.from(document.images).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    });
    return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: design.width, height: design.height } });
  });
}

export async function toWebp(png: Buffer, quality = 90): Promise<Buffer> {
  return sharp(png).webp({ quality }).toBuffer();
}

export async function toJpegOut(png: Buffer, quality = 90): Promise<Buffer> {
  return sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
}
