import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb } from '../helpers/test-db';
import { celebrityAnswer, startFakeExtension } from '../helpers/fake-extension';
import { findExtensionBrowser } from '../helpers/extension-harness';

const target = findExtensionBrowser();

const TIGRAM_ARTICLE = `SEO TITLE: Best VPN for Gaming in 2026
META DESCRIPTION: Looking for the best VPN for gaming? We compare ping, speed, servers and price so you can pick the right VPN for gaming today.
URL SLUG: best-vpn-for-gaming

A good VPN for gaming keeps your ping low and protects you from DDoS attacks. ${'Gamers want fast and stable connections without lag. '.repeat(8)}

The best VPN for gaming is one with nearby servers, WireGuard support and no bandwidth limits. ${'Speed matters most. '.repeat(5)}

## Why Use a VPN for Gaming

${'A VPN for gaming can unlock regional servers and stop throttling. '.repeat(10)}

## How to Set Up a VPN for Gaming

${'Install the app, pick a nearby server and connect before you launch the game. '.repeat(10)}

## VPN Comparison

| VPN | Speed | Price |
|---|---|---|
| A | Fast | $5 |
| B | Medium | $3 |

${'Compare speed and price carefully. '.repeat(10)}

## Frequently Asked Questions

### Is a VPN for gaming legal?
Yes, in most countries.

### Does a VPN lower ping?
Sometimes, when routing is better.

## Conclusion

${'Pick a VPN for gaming with low ping and try it today. '.repeat(4)}`;

async function jpeg(w: number, h: number, color: string) {
  return (await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer()).toString('base64');
}

describe.skipIf(!target?.executablePath)('article images', () => {
  let prisma: typeof import('@/server/db')['prisma'];
  let websiteId: string;

  async function runQueued(taskId: string) {
    const { claimNext } = await import('@/server/queue');
    const { runArticleJob } = await import('@/worker/engine/run-job');
    const job = await claimNext('article', 'test', { where: { taskId } });
    await runArticleJob(job!, new AbortController().signal);
    await prisma.queueJob.update({ where: { id: job!.id }, data: { status: 'COMPLETED' } });
    return prisma.articleTask.findUniqueOrThrow({ where: { id: taskId }, include: { stages: { orderBy: { position: 'asc' } } } });
  }

  beforeAll(async () => {
    setupTestDb();
    process.env.BROWSER_CHANNEL = 'chromium';
    process.env.CHROME_PATH = target!.executablePath!;
    ({ prisma } = await import('@/server/db'));
    const { seedPrompts } = await import('@/server/prompts');
    const { saveSettings } = await import('@/server/settings');
    const { LOGOS_DIR, ensureDir } = await import('@/server/env');
    await seedPrompts();
    await saveSettings({ retryAttempts: 0, minKeywordOccurrences: 3, maxKeywordOccurrences: 40, externalLinks: false, enhanceCelebrityImages: false });
    ensureDir(LOGOS_DIR);
    fs.writeFileSync(path.join(LOGOS_DIR, 'test-logo.png'), await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 230, g: 30, b: 60, alpha: 1 } } }).png().toBuffer());
    const site = await prisma.website.create({
      data: {
        name: 'Img Site',
        url: 'https://img.example',
        adminUrl: 'https://img.example/wp-admin',
        logoFile: 'test-logo.png',
        categories: { create: [{ name: 'Tech & Apps', wpId: 6 }, { name: 'Gaming', wpId: 7 }] },
      },
    });
    websiteId = site.id;
  }, 120_000);

  afterAll(async () => {
    const { runShutdownHooks } = await import('@/worker/runtime');
    await runShutdownHooks();
    await prisma?.$disconnect();
  });

  it('Tigram: article header, category pick, three generated pictures with the logo template', async () => {
    const pic = await jpeg(1920, 1080, '#336699');
    const ext = startFakeExtension((p, job) => {
      if (/SEO TITLE:/i.test(p)) return { text: TIGRAM_ARTICLE };
      if (/Pick the best category/i.test(p)) return { text: 'CATEGORY: Gaming' };
      if (/Plan 3 images/i.test(p)) return { text: 'IMAGE 1: A gamer at a desk\nTEXT 1: Best Gaming VPN\nALT 1: Gamer using a VPN\nIMAGE 2: A world map\nALT 2: VPN servers worldwide\nIMAGE 3: A shield\nALT 3: Online protection' };
      if (job.expect === 'images') return { text: 'Here is the image.', images: [{ base64: pic, width: 1920, height: 1080 }] };
      return { text: 'OK' };
    });
    const { createArticleTask } = await import('@/server/tasks');
    const task = await createArticleTask({ moduleKey: 'tigram-writer', keyword: 'vpn for gaming', targetCountry: 'United States', language: 'English', websiteId, secondaryKeywords: ['gaming vpn'] });
    const done = await runQueued(task.id);
    await ext.stop();

    expect(done.categoryName).toBe('Gaming');
    expect(done.slug).toBe('best-vpn-for-gaming');
    expect(done.seoTitle).toBe('Best VPN for Gaming in 2026');
    expect(done.metaDescription).toContain('best VPN for gaming');
    expect(JSON.parse(done.faqs)).toHaveLength(2);
    const images = JSON.parse(done.stages.find((s) => s.key === 'IMAGES')!.data!) as { featured: { path: string }; body: { path: string }[] };
    expect(images.featured.path).toMatch(/best-vpn-for-gaming\.jpg$/);
    expect(images.body.map((b) => path.basename(b.path))).toEqual(['best-vpn-for-gaming-1.jpg', 'best-vpn-for-gaming-2.jpg']);
    const { DATA_DIR } = await import('@/server/env');
    const meta = await sharp(fs.readFileSync(path.join(DATA_DIR, images.featured.path))).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1920, 1080, 'jpeg']);
    expect((done.contentHtml!.match(/data-bas-image="body-/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((done.contentHtml!.match(/Frequently Asked Questions/g) ?? []).length).toBe(1);
  }, 240_000);

  it('Celebrity: gallery, photo check, one picture per design, WebP output, review reason when pictures run out', async () => {
    const pics = [await jpeg(1200, 1600, '#aa3333'), await jpeg(1600, 1200, '#33aa33'), await jpeg(1000, 1000, '#3333aa')];
    const ext = startFakeExtension((p, job) => {
      if (job.expect === 'gallery') return { text: 'Photos', images: pics.map((b) => ({ base64: b, width: 1000, height: 1000 })), imageLinks: [{ url: 'http://127.0.0.1:1/blocked.jpg', width: 800, height: 600 }] };
      if (/watermark=/.test(p)) return { text: '1: watermark=no | collage=no | alt=at a premiere\n2: watermark=yes | collage=no | alt=on stage\n3: watermark=no | collage=yes | alt=collage' };
      return { text: celebrityAnswer(p) };
    });
    const { createArticleTask } = await import('@/server/tasks');
    const task = await createArticleTask({ moduleKey: 'celebrity-writer', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English', websiteId });
    const done = await runQueued(task.id);
    await ext.stop();

    const stage = done.stages.find((s) => s.key === 'IMAGES')!;
    expect(stage.status).toBe('COMPLETED');
    const data = JSON.parse(stage.data!) as { featured: { path: string; alt: string }; body: { path: string; alt: string }[]; pictures: { id: string; collage?: boolean }[]; __review?: string[] };
    expect(data.featured.path).toMatch(/sydney-sweeney\.webp$/);
    expect(data.featured.alt.startsWith('Sydney Sweeney – ')).toBe(true);
    // 3 pictures: 2 for the split featured image, the collage can't be a body image → no body image
    expect(data.body).toHaveLength(0);
    expect((data.__review ?? []).join(' ')).toMatch(/body image\(s\) left out/);
    const blockedLog = await prisma.log.findFirst({ where: { taskId: task.id, message: { contains: 'Picture link skipped' } } });
    expect(blockedLog?.message).toContain('127.0.0.1');
    const { DATA_DIR } = await import('@/server/env');
    const meta = await sharp(fs.readFileSync(path.join(DATA_DIR, data.featured.path))).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1920, 1080, 'webp']);
  }, 240_000);
});
