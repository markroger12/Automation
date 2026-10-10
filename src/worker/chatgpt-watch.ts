import { prisma } from '@/server/db';
import { enqueue, hasPendingJob } from '@/server/queue';
import { writeLog } from '@/server/log';
import { parseJson } from '@/lib/json';
import { enqueueArticleRun } from '@/server/tasks';
import { EXTENSION_ONLINE_MS, EXTENSION_STATUS_ID, type ExtensionInfo } from '@/server/status';

/** A claimed ChatGPT job with no progress for this long is treated as abandoned. */
export const ABANDON_MS = 90_000;
const MAX_ABANDONS = 3;
const AUTO_OPEN_EVERY_MS = 3 * 60_000;
const LOGIN_RESUME_EVERY_MS = 5 * 60_000;

let lastAutoOpen = 0;
const lastResume = new Map<string, number>();

type ChatJobData = { allowReuse?: boolean; abandoned?: number; [k: string]: unknown };

/** Re-queues ChatGPT jobs whose tab went silent. The prompt may have been sent, so reuse is allowed. */
export async function requeueAbandonedChatJobs(now = Date.now()): Promise<number> {
  const stale = await prisma.queueJob.findMany({
    where: { queue: 'chatgpt', status: 'ACTIVE', heartbeatAt: { lt: new Date(now - ABANDON_MS) } },
  });
  let n = 0;
  for (const job of stale) {
    const data = parseJson<ChatJobData>(job.data, {});
    const abandoned = (data.abandoned ?? 0) + 1;
    if (abandoned > MAX_ABANDONS) {
      await prisma.queueJob.updateMany({
        where: { id: job.id, status: 'ACTIVE' },
        data: { status: 'FAILED', error: 'The ChatGPT tab stopped responding (no progress for 90 seconds, several times).', finishedAt: new Date() },
      });
    } else {
      await prisma.queueJob.updateMany({
        where: { id: job.id, status: 'ACTIVE' },
        data: {
          status: 'WAITING',
          lockedBy: null,
          heartbeatAt: null,
          startedAt: null,
          data: JSON.stringify({ ...data, allowReuse: data.fresh ? false : true, abandoned }),
        },
      });
    }
    n++;
    await writeLog({
      level: 'WARN',
      category: 'CHATGPT',
      taskId: job.taskId,
      message: `ChatGPT tab gave no progress for ${Math.round(ABANDON_MS / 1000)} s; ${abandoned > MAX_ABANDONS ? 'giving up on this prompt' : 'the prompt goes back to the queue (an answer already written will be recovered)'}.`,
      data: { jobId: job.id, lockedBy: job.lockedBy },
    });
  }
  return n;
}

async function extensionState() {
  const row = await prisma.workerStatus.findUnique({ where: { id: EXTENSION_STATUS_ID } });
  const info = parseJson<ExtensionInfo & { readyTabs?: number; loginNeeded?: boolean }>(row?.info, {});
  const online = !!row && Date.now() - row.lastSeenAt.getTime() < EXTENSION_ONLINE_MS;
  return { online, info };
}

/** Opens the Automation Chrome whenever ChatGPT jobs are waiting and the extension is not reporting. */
async function autoOpenChrome(): Promise<void> {
  const waiting = await prisma.queueJob.count({ where: { queue: 'chatgpt', status: 'WAITING' } });
  if (waiting === 0) return;
  const ext = await extensionState();
  if (ext.online) return;
  if (Date.now() - lastAutoOpen < AUTO_OPEN_EVERY_MS) return;
  if (await hasPendingJob('control', 'open-chatgpt-chrome')) return;
  lastAutoOpen = Date.now();
  await enqueue('control', 'open-chatgpt-chrome', { reason: `${waiting} ChatGPT prompt(s) waiting` });
}

/** Tasks paused for a ChatGPT login continue once the extension reports a ready ChatGPT tab. */
async function resumeChatgptLogins(): Promise<void> {
  const ext = await extensionState();
  if (!ext.online || ext.info.loginNeeded || !(ext.info.readyTabs && ext.info.readyTabs > 0)) return;
  const tasks = await prisma.articleTask.findMany({ where: { status: 'LOGIN_REQUIRED', loginRequiredFor: 'chatgpt' }, select: { id: true } });
  for (const t of tasks) {
    if (Date.now() - (lastResume.get(t.id) ?? 0) < LOGIN_RESUME_EVERY_MS) continue;
    lastResume.set(t.id, Date.now());
    if (await enqueueArticleRun(t.id, { mode: 'run', reason: 'chatgpt-ready' })) {
      await prisma.articleTask.update({ where: { id: t.id }, data: { status: 'QUEUED', statusMessage: 'ChatGPT is ready again — resuming' } });
      await writeLog({ taskId: t.id, category: 'SESSION', message: 'ChatGPT is ready again; the article continues from its last completed stage.' });
    }
  }
}

/** WordPress logins: resume when the website's profile tested ACTIVE after the task paused. */
async function resumeWordpressLogins(): Promise<void> {
  const tasks = await prisma.articleTask.findMany({
    where: { status: 'LOGIN_REQUIRED', loginRequiredFor: 'wordpress' },
    select: { id: true, updatedAt: true, website: { select: { profile: { select: { sessionStatus: true, lastCheckedAt: true } } } } },
  });
  for (const t of tasks) {
    const p = t.website?.profile;
    if (!p || p.sessionStatus !== 'ACTIVE' || !p.lastCheckedAt || p.lastCheckedAt <= t.updatedAt) continue;
    if (Date.now() - (lastResume.get(t.id) ?? 0) < LOGIN_RESUME_EVERY_MS) continue;
    lastResume.set(t.id, Date.now());
    if (await enqueueArticleRun(t.id, { mode: 'run', reason: 'wordpress-ready' })) {
      await prisma.articleTask.update({ where: { id: t.id }, data: { status: 'QUEUED', statusMessage: 'WordPress session is active again — resuming' } });
      await writeLog({ taskId: t.id, category: 'SESSION', message: 'The WordPress session works again; the article continues.' });
    }
  }
}

export async function chatgptWatchTick(): Promise<void> {
  await requeueAbandonedChatJobs();
  await autoOpenChrome();
  await resumeChatgptLogins();
  await resumeWordpressLogins();
}
