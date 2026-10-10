import type { Prisma, QueueJob } from '@prisma/client';
import { prisma } from './db';
import { parseJson } from '@/lib/json';

export type QueueName = 'article' | 'chatgpt' | 'control' | 'workflow' | 'humanizer';

export type EnqueueOptions = { taskId?: string | null; runAt?: Date };

export async function enqueue(queue: QueueName, name: string, data: unknown = {}, opts: EnqueueOptions = {}): Promise<QueueJob> {
  return prisma.queueJob.create({
    data: {
      queue,
      name,
      taskId: opts.taskId ?? null,
      data: JSON.stringify(data ?? {}),
      runAt: opts.runAt ?? new Date(),
    },
  });
}

/**
 * Claims the oldest runnable job of a queue. Safe across processes: the WAITING→ACTIVE switch is a
 * conditional update, so only one claimer wins.
 */
export async function claimNext(
  queue: QueueName,
  lockedBy: string,
  opts: { where?: Prisma.QueueJobWhereInput; preferIds?: string[] } = {},
): Promise<QueueJob | null> {
  for (let i = 0; i < 5; i++) {
    const now = new Date();
    const baseWhere: Prisma.QueueJobWhereInput = { queue, status: 'WAITING', runAt: { lte: now }, ...(opts.where ?? {}) };
    let candidate: QueueJob | null = null;
    if (opts.preferIds?.length) {
      candidate = await prisma.queueJob.findFirst({ where: { ...baseWhere, id: { in: opts.preferIds } }, orderBy: { createdAt: 'asc' } });
    }
    candidate ??= await prisma.queueJob.findFirst({ where: baseWhere, orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }] });
    if (!candidate) return null;
    const res = await prisma.queueJob.updateMany({
      where: { id: candidate.id, status: 'WAITING' },
      data: { status: 'ACTIVE', lockedBy, startedAt: now, heartbeatAt: now, attempts: { increment: 1 } },
    });
    if (res.count === 1) return prisma.queueJob.findUnique({ where: { id: candidate.id } });
  }
  return null;
}

export async function heartbeat(jobId: string, extra: Prisma.QueueJobUpdateInput = {}): Promise<void> {
  await prisma.queueJob.updateMany({ where: { id: jobId, status: 'ACTIVE' }, data: { heartbeatAt: new Date(), ...(extra as object) } });
}

export async function completeJob(jobId: string, result: unknown = null): Promise<boolean> {
  const res = await prisma.queueJob.updateMany({
    where: { id: jobId, status: { in: ['ACTIVE', 'WAITING'] } },
    data: { status: 'COMPLETED', result: JSON.stringify(result ?? null), finishedAt: new Date(), error: null },
  });
  return res.count === 1;
}

export async function failJob(jobId: string, error: string, result: unknown = null): Promise<boolean> {
  const res = await prisma.queueJob.updateMany({
    where: { id: jobId, status: { in: ['ACTIVE', 'WAITING'] } },
    data: { status: 'FAILED', error: error.slice(0, 4000), result: result === null ? undefined : JSON.stringify(result), finishedAt: new Date() },
  });
  return res.count === 1;
}

/** Puts an ACTIVE job back to WAITING (for example a claim that lost a race with a closing tab). */
export async function requeueJob(jobId: string, opts: { runAt?: Date; data?: unknown } = {}): Promise<boolean> {
  const res = await prisma.queueJob.updateMany({
    where: { id: jobId, status: 'ACTIVE' },
    data: {
      status: 'WAITING',
      lockedBy: null,
      heartbeatAt: null,
      startedAt: null,
      runAt: opts.runAt ?? new Date(),
      ...(opts.data !== undefined ? { data: JSON.stringify(opts.data) } : {}),
    },
  });
  return res.count === 1;
}

export function jobData<T>(job: Pick<QueueJob, 'data'>, fallback: T): T {
  return parseJson<T>(job.data, fallback);
}

export function jobResult<T>(job: Pick<QueueJob, 'result'>, fallback: T): T {
  return parseJson<T>(job.result, fallback);
}

/** True when a job with this queue/name (and optional task) is waiting or running. */
export async function hasPendingJob(queue: QueueName, name?: string, taskId?: string): Promise<boolean> {
  const n = await prisma.queueJob.count({
    where: { queue, ...(name ? { name } : {}), ...(taskId ? { taskId } : {}), status: { in: ['WAITING', 'ACTIVE'] } },
  });
  return n > 0;
}

/**
 * Called once when the worker starts. A job left ACTIVE by a dead worker is re-queued (article) or
 * failed (others). ChatGPT prompts nobody waits for any more are failed too, so no tab sends them.
 */
export async function recoverJobs(): Promise<{ requeued: number; failed: number }> {
  const now = new Date();
  const requeued = await prisma.queueJob.updateMany({
    where: { queue: 'article', status: 'ACTIVE' },
    data: { status: 'WAITING', lockedBy: null, heartbeatAt: null, startedAt: null, runAt: now },
  });
  const failedOthers = await prisma.queueJob.updateMany({
    where: { queue: { in: ['control', 'workflow', 'humanizer'] }, status: 'ACTIVE' },
    data: { status: 'FAILED', error: 'The worker stopped while this job was running.', finishedAt: now },
  });
  const failedChat = await prisma.queueJob.updateMany({
    where: { queue: 'chatgpt', status: { in: ['WAITING', 'ACTIVE'] } },
    data: { status: 'FAILED', error: 'The worker restarted; the prompt is asked again by the resumed stage.', finishedAt: now },
  });
  return { requeued: requeued.count, failed: failedOthers.count + failedChat.count };
}

/** Removes finished jobs older than `days` (their results live on the task rows). */
export async function pruneJobs(days = 14): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const res = await prisma.queueJob.deleteMany({ where: { status: { in: ['COMPLETED', 'FAILED'] }, finishedAt: { lt: cutoff } } });
  return res.count;
}
