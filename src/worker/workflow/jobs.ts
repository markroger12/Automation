import type { QueueJob } from '@prisma/client';
import { prisma } from '@/server/db';
import { jobData } from '@/server/queue';
import { writeLog } from '@/server/log';
import { ConfigError } from '@/server/errors';
import { formatInZone, formatPkt } from '@/core/workflow-time';
import { withProfilePage } from '../browser/profiles';
import { allowStatusesFor, installPublishGuard, openAdmin } from '../wordpress/session';
import { wpRestOk } from '../wordpress/rest';
import { findFirst } from '../selectors';
import { captureScreenshot } from '../screenshots';

type PostOut = { id: number; status: string; date: string; date_gmt: string; link?: string };

/**
 * The only code that may publish: sets status "future" with the local date in the site's time zone — and only
 * when the website's owner switched on "This website may publish by itself" (checked again here).
 */
async function schedulePost(keywordId: string) {
  const kw = await prisma.workflowKeyword.findUnique({ where: { id: keywordId }, include: { task: true, workflow: { include: { website: true } } } });
  if (!kw?.task?.wpPostId || !kw.publishAt) throw new Error('Nothing to schedule.');
  const website = kw.workflow.website;
  if (!website.canPublish) throw new ConfigError('This website may not publish by itself (Workflow settings).');
  if (!website.profileId) throw new ConfigError('The website has no browser profile.');
  if (kw.publishAt.getTime() < Date.now() + 2 * 60_000) throw new Error('The publish time has passed; the scheduler gives the article a new slot.');
  const postId = kw.task.wpPostId;
  const local = formatInZone(kw.publishAt, website.siteTimezone);
  const result = await withProfilePage(website.profileId, async (page, context) => {
    await installPublishGuard(context, kw.taskId);
    allowStatusesFor(context, ['future']);
    try {
      await openAdmin(page, website, 'edit.php', kw.taskId);
      const current = await wpRestOk<PostOut>(page, website.adminUrl, { path: `/wp/v2/posts/${postId}`, query: { context: 'edit' } });
      if (current.status === 'publish') return current;
      let out = await wpRestOk<PostOut>(page, website.adminUrl, { method: 'POST', path: `/wp/v2/posts/${postId}`, body: { status: 'future', date: local }, allowedStatuses: ['future'] });
      const wantGmt = kw.publishAt!.toISOString().slice(0, 19);
      if (out.date_gmt && Math.abs(Date.parse(`${out.date_gmt}Z`) - kw.publishAt!.getTime()) > 90_000) {
        // The site's time zone differs from what we stored: set the UTC time directly.
        out = await wpRestOk<PostOut>(page, website.adminUrl, { method: 'POST', path: `/wp/v2/posts/${postId}`, body: { status: 'future', date_gmt: wantGmt }, allowedStatuses: ['future'] });
      }
      return out;
    } finally {
      allowStatusesFor(context, []);
    }
  });
  if (result.status !== 'future' && result.status !== 'publish') throw new Error(`WordPress answered status "${result.status}".`);
  await prisma.workflowKeyword.update({ where: { id: kw.id }, data: { state: result.status === 'publish' ? 'PUBLISHED' : 'SCHEDULED', lastError: null, ...(result.status === 'publish' ? { publishedAt: new Date(), publishedUrl: result.link ?? null } : {}) } });
  await writeLog({ taskId: kw.taskId, category: 'WORDPRESS', stage: 'WORKFLOW', message: `Post ${postId} scheduled for ${formatPkt(kw.publishAt)} Pakistan time (${local} ${website.siteTimezone ?? 'UTC'}).` });
  return { status: result.status, date: result.date };
}

/** Search Console URL inspection in the website's own profile (a Google account already logged in there). */
async function requestIndexing(keywordId: string) {
  const kw = await prisma.workflowKeyword.findUnique({ where: { id: keywordId }, include: { workflow: { include: { website: true } } } });
  if (!kw?.publishedUrl) throw new Error('The article has no published address yet.');
  const website = kw.workflow.website;
  if (!website.searchConsoleProperty || !website.profileId) throw new ConfigError('No Search Console property or browser profile for this website.');
  const attempt = kw.indexAttempts + 1;
  let outcome: 'requested' | 'quota' | 'error' = 'error';
  let detail = '';
  try {
    outcome = await withProfilePage(website.profileId, async (page) => {
      const url = `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(website.searchConsoleProperty!)}&id=${encodeURIComponent(kw.publishedUrl!)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      if (/accounts\.google\.com/.test(page.url())) {
        detail = 'Google asks for a login in this website’s profile (Websites → Open Browser, log in to Search Console).';
        return 'error';
      }
      const button = await findFirst(page, 'gsc.requestIndexing', { timeoutMs: 120_000, visible: true });
      if (!button) {
        detail = `“Request indexing” was not found. Screenshot: ${(await captureScreenshot(page, 'gsc-error', kw.taskId)) ?? 'off'}`;
        return 'error';
      }
      await button.click();
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        if (await findFirst(page, 'gsc.requestedDialog', { visible: true })) return 'requested';
        if (await findFirst(page, 'gsc.quotaExceeded', { visible: true })) return 'quota';
        await page.waitForTimeout(2000);
      }
      detail = 'Search Console did not confirm the request.';
      return 'error';
    });
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }
  if (outcome === 'requested') {
    await prisma.workflowKeyword.update({ where: { id: kw.id }, data: { state: 'INDEXED', indexedAt: new Date(), indexAttempts: attempt, lastError: null } });
    await writeLog({ taskId: kw.taskId, category: 'SESSION', stage: 'WORKFLOW', message: `Indexing requested for ${kw.publishedUrl}.` });
    return { outcome };
  }
  // Google allows about 10 requests a day per property: retry after 6 hours when the quota is used up, else after 30 minutes.
  const wait = outcome === 'quota' ? 6 * 3600_000 : 30 * 60_000;
  await prisma.workflowKeyword.update({ where: { id: kw.id }, data: { indexAttempts: attempt, nextIndexAt: new Date(Date.now() + wait), lastError: outcome === 'quota' ? 'Search Console quota used up; trying again in 6 hours.' : detail.slice(0, 300) } });
  await writeLog({ taskId: kw.taskId, level: 'WARN', category: 'SESSION', stage: 'WORKFLOW', message: `Indexing not requested (${outcome}${detail ? `: ${detail}` : ''}); attempt ${attempt}/3.` });
  return { outcome, detail };
}

export async function handleWorkflowJob(job: QueueJob): Promise<unknown> {
  const { keywordId } = jobData<{ keywordId: string }>(job, { keywordId: '' });
  if (job.name === 'schedule-post') {
    try {
      return await schedulePost(keywordId);
    } catch (err) {
      await prisma.workflowKeyword.update({ where: { id: keywordId }, data: { lastError: `Scheduling failed: ${err instanceof Error ? err.message : err}`.slice(0, 300) } }).catch(() => undefined);
      throw err;
    }
  }
  if (job.name === 'request-indexing') return requestIndexing(keywordId);
  throw new Error(`Unknown workflow job ${job.name}`);
}
