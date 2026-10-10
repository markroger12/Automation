import type { Workflow, WorkflowKeyword, Website, ArticleTask } from '@prisma/client';
import { prisma } from '@/server/db';
import { enqueue } from '@/server/queue';
import { createArticleTask, retryTask } from '@/server/tasks';
import { writeLog } from '@/server/log';
import { stringArray } from '@/lib/json';
import type { Settings } from '@/lib/settings-schema';
import { nextFreeSlot, formatPkt } from '@/core/workflow-time';
import { currentSettings } from '../runtime';
import { detectUnknownKinds } from './kind';
import { readFeed, normTitle } from '../links/feed';

export const MAX_WRITE_AHEAD = 10;
const LATE_MARGIN_MS = 3 * 60_000;
const ACTIVE_STATES = ['WAITING', 'WRITING', 'READY', 'SCHEDULED', 'PUBLISHED', 'INDEXED', 'DONE'] as const;

type Kw = WorkflowKeyword & { task: ArticleTask | null };

function parseList<T>(raw: string, fallback: T[]): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

async function log(taskId: string | null, message: string, level: 'INFO' | 'WARN' = 'INFO') {
  await writeLog({ taskId, level, category: 'QUEUE', stage: 'WORKFLOW', message });
}

async function pendingJob(name: string, keywordId: string): Promise<boolean> {
  return (await prisma.queueJob.count({ where: { queue: 'workflow', name, status: { in: ['WAITING', 'ACTIVE'] }, data: { contains: keywordId } } })) > 0;
}

async function recentFailure(name: string, keywordId: string, minutes: number): Promise<boolean> {
  return (await prisma.queueJob.count({ where: { queue: 'workflow', name, status: 'FAILED', data: { contains: keywordId }, finishedAt: { gt: new Date(Date.now() - minutes * 60_000) } } })) > 0;
}

/** Writer for a workflow keyword: celebrity keywords use the writer chosen in Settings. */
export function writerFor(kind: 'CELEBRITY' | 'TIGRAM', settings: Settings): string {
  if (kind === 'TIGRAM') return 'tigram-writer';
  return settings.workflowCelebrityWriter === '2.0' ? 'celebrity-writer-2' : 'celebrity-writer';
}

/** Live once the post's ?p= address redirects to its permalink (or the feed lists its title). */
export async function checkPublished(website: Website, task: ArticleTask): Promise<{ url: string } | null> {
  const site = website.url.replace(/\/+$/, '');
  if (task.wpPostId) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(`${site}/?p=${task.wpPostId}`, { redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok && !/[?&]p=\d+/.test(res.url)) return { url: res.url };
    } catch {
      // fall through to the feed
    }
  }
  if (task.selectedTitle) {
    const item = (await readFeed(site)).find((i) => normTitle(i.title) === normTitle(task.selectedTitle!));
    if (item) return { url: item.link };
  }
  return null;
}

async function tickWorkflow(wf: Workflow & { website: Website }, settings: Settings, now: Date): Promise<void> {
  const times = parseList<string>(wf.publishTimes, []);
  const days = parseList<number>(wf.days, []);
  const kws: Kw[] = await prisma.workflowKeyword.findMany({ where: { workflowId: wf.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { task: true } });
  const update = async (kw: Kw, data: Partial<WorkflowKeyword>) => {
    Object.assign(kw, data);
    await prisma.workflowKeyword.update({ where: { id: kw.id }, data });
  };

  // 1. Follow the articles being written. NEEDS_REVIEW counts as finished.
  for (const kw of kws.filter((k) => k.state === 'WRITING')) {
    const t = kw.task;
    if (!t) {
      await update(kw, { state: 'WAITING', taskId: null, publishAt: null });
      continue;
    }
    if (t.status === 'DRAFT_CREATED' || t.status === 'NEEDS_REVIEW') {
      await update(kw, { state: 'READY', lastError: t.status === 'NEEDS_REVIEW' ? `Needs review: ${stringArray(t.reviewReasons)[0] ?? ''}`.slice(0, 300) : null });
    } else if (t.status === 'FAILED' || t.status === 'CANCELLED') {
      if (kw.attempts >= 3) {
        await update(kw, { state: 'FAILED', lastError: t.error ?? 'The article failed 3 times.', publishAt: null });
        await log(t.id, `Workflow: "${kw.keyword}" failed 3 times and is left alone.`, 'WARN');
      } else {
        // A failed article loses its slot and takes the next free one.
        await retryTask(t.id);
        await update(kw, { attempts: kw.attempts + 1, publishAt: null, lastError: t.error });
        await log(t.id, `Workflow: "${kw.keyword}" failed (${t.error ?? 'unknown'}); retry ${kw.attempts}/3, it gets the next free slot.`, 'WARN');
      }
    }
  }

  // 2. A late article loses its slot.
  for (const kw of kws.filter((k) => ['WAITING', 'WRITING', 'READY'].includes(k.state) && k.publishAt && k.publishAt.getTime() < now.getTime() + LATE_MARGIN_MS)) {
    await update(kw, { publishAt: null });
    if (kw.state !== 'WAITING') await log(kw.taskId, `Workflow: "${kw.keyword}" missed its slot; it takes the next free one.`, 'WARN');
  }

  // 3. One article per publish time.
  if (times.length) {
    const taken = kws.filter((k) => k.publishAt && (ACTIVE_STATES as readonly string[]).includes(k.state)).map((k) => k.publishAt!);
    for (const kw of kws.filter((k) => ['WAITING', 'WRITING', 'READY'].includes(k.state) && !k.publishAt && k.kind !== 'UNKNOWN')) {
      const slot = nextFreeSlot(times, days, new Date(now.getTime() + LATE_MARGIN_MS), taken);
      if (!slot) break;
      taken.push(slot);
      await update(kw, { publishAt: slot });
    }
  }

  // 4. Start writing: as soon as added, or N hours before the publish time; at most 10 written ahead.
  if (wf.website.isActive) {
    let ahead = kws.filter((k) => k.state === 'WRITING' || k.state === 'READY').length;
    for (const kw of kws.filter((k) => k.state === 'WAITING' && k.kind !== 'UNKNOWN')) {
      if (ahead >= MAX_WRITE_AHEAD) break;
      if (wf.writeAheadHours > 0 && (!kw.publishAt || kw.publishAt.getTime() - now.getTime() > wf.writeAheadHours * 3600_000)) continue;
      const lang = wf.website.language === 'German' ? 'German' : 'English';
      const task = await createArticleTask({
        moduleKey: writerFor(kw.kind as 'CELEBRITY' | 'TIGRAM', settings),
        keyword: kw.keyword,
        exampleTitle: kw.title,
        secondaryKeywords: stringArray(kw.secondaryKeywords),
        targetCountry: wf.website.targetCountry || (lang === 'German' ? 'Germany' : settings.targetCountry),
        language: lang,
        websiteId: wf.website.id,
        categoryId: kw.kind === 'CELEBRITY' ? wf.website.defaultCategoryId : null,
        autoApprove: true,
        imagesMode: wf.images,
      });
      await update(kw, { state: 'WRITING', taskId: task.id, attempts: kw.attempts + 1, lastError: null });
      await log(task.id, `Workflow: writing "${kw.keyword}"${kw.publishAt ? ` for ${formatPkt(kw.publishAt)} (Pakistan time)` : ''}.`);
      ahead++;
    }
  }

  // 5. Schedule ready drafts (only for websites allowed to publish by themselves).
  for (const kw of kws.filter((k) => k.state === 'READY' && k.publishAt && k.task?.wpPostId)) {
    if (!wf.website.canPublish) continue;
    if ((await pendingJob('schedule-post', kw.id)) || (await recentFailure('schedule-post', kw.id, 15))) continue;
    await enqueue('workflow', 'schedule-post', { keywordId: kw.id }, { taskId: kw.taskId });
  }

  // 6. Published?
  for (const kw of kws.filter((k) => k.state === 'SCHEDULED' && k.publishAt && k.publishAt.getTime() <= now.getTime() - 60_000 && k.task)) {
    const live = await checkPublished(wf.website, kw.task!);
    if (live) {
      await update(kw, { state: 'PUBLISHED', publishedUrl: live.url, publishedAt: now });
      await prisma.articleTask.update({ where: { id: kw.task!.id }, data: { wpPostUrl: live.url } });
      await log(kw.taskId, `Workflow: "${kw.keyword}" is live at ${live.url}.`);
    }
  }

  // 7. Ask Google to index it (about 10 requests a day per property).
  for (const kw of kws.filter((k) => k.state === 'PUBLISHED')) {
    if (!wf.indexAfterPublish || !wf.website.searchConsoleProperty) {
      await update(kw, { state: 'DONE' });
      continue;
    }
    if (kw.indexAttempts >= 3) {
      await update(kw, { state: 'DONE', lastError: kw.lastError ?? 'Indexing was not requested after 3 tries.' });
      continue;
    }
    if (kw.nextIndexAt && kw.nextIndexAt > now) continue;
    if (await pendingJob('request-indexing', kw.id)) continue;
    await enqueue('workflow', 'request-indexing', { keywordId: kw.id }, { taskId: kw.taskId });
  }
}

/** Runs every minute in the worker. It never opens a browser itself; browser work goes to workflow jobs. */
export async function workflowTick(now = new Date()): Promise<void> {
  const settings = await currentSettings();
  await detectUnknownKinds(5).catch(() => undefined);
  const flows = await prisma.workflow.findMany({ where: { isActive: true }, include: { website: true } });
  for (const wf of flows) {
    try {
      await tickWorkflow(wf, settings, now);
    } catch (err) {
      await writeLog({ level: 'ERROR', category: 'QUEUE', stage: 'WORKFLOW', message: `Workflow of ${wf.website.name} failed: ${err instanceof Error ? err.message : err}` });
    }
  }
}
