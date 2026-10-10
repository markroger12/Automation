import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { setupTestDb } from '../helpers/test-db';
import { celebrityAnswer, startFakeExtension } from '../helpers/fake-extension';
import { FakeWordPress } from '../helpers/fake-wordpress';
import { findExtensionBrowser } from '../helpers/extension-harness';

const target = findExtensionBrowser();

describe.skipIf(!target?.executablePath)('WordPress automation against a fake WordPress', () => {
  let wp: FakeWordPress;
  let prisma: typeof import('@/server/db')['prisma'];
  let websiteId: string;

  async function login(profileDirName: string) {
    const { PROFILES_DIR } = await import('@/server/env');
    const dir = path.join(PROFILES_DIR, profileDirName);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await chromium.launchPersistentContext(dir, { executablePath: target!.executablePath, headless: true });
    await ctx.addCookies([{ name: wp.cookie, value: '1', url: wp.url, expires: Math.floor(Date.now() / 1000) + 86400 }]);
    await ctx.close();
  }

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
    wp = new FakeWordPress();
    await wp.start();
    ({ prisma } = await import('@/server/db'));
    const { seedPrompts } = await import('@/server/prompts');
    const { saveSettings } = await import('@/server/settings');
    await seedPrompts();
    await saveSettings({ retryAttempts: 0, minKeywordOccurrences: 3, maxKeywordOccurrences: 30, rankMathTargetScore: 75, browserMode: 'headless', articleImages: false });
    const site = await prisma.website.create({
      data: { name: 'Fake Site', url: wp.url, adminUrl: `${wp.url}/wp-admin`, language: 'English', profile: { create: { name: 'Fake Site', directory: `fake-${Date.now()}` } } },
      include: { profile: true },
    });
    websiteId = site.id;
    await login(site.profile!.directory);
  }, 120_000);

  afterAll(async () => {
    const { runShutdownHooks } = await import('@/worker/runtime');
    await runShutdownHooks();
    await wp?.close();
    await prisma?.$disconnect();
  });

  it('tests the session and syncs categories through the control job', async () => {
    await import('@/worker/wordpress/control-handlers');
    const { handleControlJob } = await import('@/worker/control');
    const job = await prisma.queueJob.create({ data: { queue: 'control', name: 'profile-refresh', data: JSON.stringify({ websiteId }) } });
    const result = (await handleControlJob(job, new AbortController().signal)) as { ok: boolean; categories: { count: number } };
    expect(result.ok).toBe(true);
    expect(result.categories.count).toBe(3);
    const cats = await prisma.category.findMany({ where: { websiteId }, orderBy: { name: 'asc' } });
    expect(cats.map((c) => c.name)).toEqual(['Celebrities', 'Tech & Apps', 'Uncategorized']);
    const site = await prisma.website.findUniqueOrThrow({ where: { id: websiteId }, include: { profile: true } });
    expect(site.profile!.sessionStatus).toBe('ACTIVE');
    expect(site.siteTimezone).toBe('Europe/Berlin');
  }, 120_000);

  it('saves a draft with one category, tags, Rank Math fields and reaches the Rank Math target', async () => {
    const cat = await prisma.category.findFirstOrThrow({ where: { websiteId, name: 'Celebrities' } });
    const { createArticleTask } = await import('@/server/tasks');
    const ext = startFakeExtension((p) => ({ text: celebrityAnswer(p) }));
    const task = await createArticleTask({ moduleKey: 'celebrity-writer', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English', websiteId, categoryId: cat.id });
    const done = await runQueued(task.id);
    await ext.stop();

    expect(done.stages.find((s) => s.key === 'WORDPRESS_DRAFT')!.status).toBe('COMPLETED');
    expect(done.wpPostId).toBeTruthy();
    const post = wp.posts.get(done.wpPostId!)!;
    expect(post.status).toBe('draft');
    expect(post.categories).toEqual([5]);
    expect(post.slug).toBe('sydney-sweeney');
    expect(post.content).toContain('<!-- wp:heading -->');
    expect(post.content).toContain('quick-bio-table');
    expect(post.tags.length).toBeGreaterThan(0);
    expect(wp.meta.get(post.id)).toMatchObject({ rank_math_focus_keyword: 'Sydney Sweeney' });
    expect(done.wpEditUrl).toBe(`${wp.url}/wp-admin/post.php?post=${post.id}&action=edit`);
    // Rank Math: the alt-text test cannot be fixed by the app (no images here), everything else passes
    expect(done.rankMathScore).toBe(88);
    expect(done.status).toBe('NEEDS_REVIEW');
    expect(JSON.parse(done.reviewReasons).join(' ')).toContain('No internal link');
    expect(wp.requests.some((r) => /"status":"(publish|future)"/.test(r.body))).toBe(false);
  }, 180_000);

  it('reopens the same post on retry instead of creating a duplicate', async () => {
    const task = await prisma.articleTask.findFirstOrThrow({ where: { websiteId, wpPostId: { not: null } } });
    const before = wp.posts.size;
    const { retryTask } = await import('@/server/tasks');
    await prisma.articleStage.updateMany({ where: { taskId: task.id, key: { in: ['WORDPRESS_DRAFT', 'RANKMATH'] } }, data: { status: 'PENDING' } });
    await retryTask(task.id);
    const done = await runQueued(task.id);
    expect(done.wpPostId).toBe(task.wpPostId);
    expect(wp.posts.size).toBe(before);
  }, 180_000);

  it('blocks publishing requests at the network level', async () => {
    const task = await prisma.articleTask.findFirstOrThrow({ where: { websiteId, wpPostId: { not: null } } });
    const site = await prisma.website.findUniqueOrThrow({ where: { id: websiteId } });
    const { withProfilePage } = await import('@/worker/browser/profiles');
    const { installPublishGuard, openAdmin } = await import('@/worker/wordpress/session');
    const outcome = await withProfilePage(site.profileId!, async (page, context) => {
      await installPublishGuard(context);
      await openAdmin(page, site);
      return page.evaluate(
        async (a) => {
          try {
            const r = await fetch(a.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': a.nonce }, body: JSON.stringify({ status: 'publish' }) });
            return `status ${r.status}`;
          } catch (e) {
            return `blocked: ${(e as Error).message}`;
          }
        },
        { url: `${wp.url}/wp-json/wp/v2/posts/${task.wpPostId}`, nonce: wp.nonce },
      );
    });
    expect(outcome).toMatch(/^blocked/);
    expect(wp.posts.get(task.wpPostId!)!.status).toBe('draft');
  }, 120_000);

  it('converts WebP to JPEG when WordPress refuses WebP', async () => {
    wp.webpAllowed = false;
    const sharp = (await import('sharp')).default;
    const { MEDIA_DIR } = await import('@/server/env');
    fs.mkdirSync(path.join(MEDIA_DIR, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, 'tests', 'pic.webp'), await sharp({ create: { width: 40, height: 30, channels: 3, background: '#123456' } }).webp().toBuffer());
    const site = await prisma.website.findUniqueOrThrow({ where: { id: websiteId } });
    const { withProfilePage } = await import('@/worker/browser/profiles');
    const { openAdmin } = await import('@/worker/wordpress/session');
    const { uploadImage } = await import('@/worker/wordpress/draft');
    const up = await withProfilePage(site.profileId!, async (page) => {
      await openAdmin(page, site);
      return uploadImage(page, site.adminUrl, 'media/tests/pic.webp', 'Sydney Sweeney – red carpet', 1);
    });
    expect(up.url).toMatch(/pic\.jpg$/);
    expect(wp.media.get(up.id)!.alt).toBe('Sydney Sweeney – red carpet');
    wp.webpAllowed = true;
  }, 120_000);

  it('pauses with LOGIN_REQUIRED when the WordPress session is gone', async () => {
    const other = await prisma.website.create({ data: { name: 'Logged out', url: wp.url, adminUrl: `${wp.url}/wp-admin`, profile: { create: { name: 'x', directory: `nologin-${Date.now()}` } } } });
    const { createArticleTask } = await import('@/server/tasks');
    const ext = startFakeExtension((p) => ({ text: celebrityAnswer(p) }));
    const task = await createArticleTask({ moduleKey: 'celebrity-writer', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English', websiteId: other.id });
    const done = await runQueued(task.id);
    await ext.stop();
    expect(done.status).toBe('LOGIN_REQUIRED');
    expect(done.loginRequiredFor).toBe('wordpress');
    expect(done.stages.find((s) => s.key === 'WORDPRESS_DRAFT')!.status).toBe('PENDING');
    const log = await prisma.log.findFirst({ where: { taskId: task.id, category: 'SESSION' } });
    expect(log!.screenshotPath).toBeTruthy();
  }, 180_000);
});
