import type { ArticleTask, Prisma } from '@prisma/client';
import { prisma } from './db';
import { enqueue } from './queue';
import { getModule } from '@/modules/registry';

export type ArticleJobData = { mode: 'run' | 'regenerate'; stageKey?: string; reason?: string };

/**
 * Adds a pipeline run for a task unless one is already waiting or running.
 * Regenerate requests replace a waiting plain run (the regenerate covers it).
 */
export async function enqueueArticleRun(taskId: string, data: ArticleJobData = { mode: 'run' }, runAt?: Date): Promise<boolean> {
  const pending = await prisma.queueJob.findMany({ where: { queue: 'article', taskId, status: { in: ['WAITING', 'ACTIVE'] } } });
  if (pending.some((j) => j.status === 'ACTIVE')) {
    if (data.mode === 'regenerate') {
      // Run the regeneration after the active run finishes.
      if (!pending.some((j) => j.status === 'WAITING')) await enqueue('article', 'run-pipeline', data, { taskId, runAt });
      return true;
    }
    return false;
  }
  if (pending.length > 0) {
    if (data.mode === 'regenerate') {
      await prisma.queueJob.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { data: JSON.stringify(data), runAt: runAt ?? new Date() } });
      return true;
    }
    return false;
  }
  await enqueue('article', 'run-pipeline', data, { taskId, runAt });
  return true;
}

export type NewTaskInput = {
  moduleKey: string;
  keyword: string;
  exampleTitle?: string | null;
  secondaryKeywords?: string[];
  targetCountry: string;
  language: string;
  websiteId?: string | null;
  categoryId?: string | null;
  autoApprove?: boolean;
  imagesMode?: string | null;
  createdById?: string | null;
};

/** Creates the task, its stage rows (all PENDING) and the first pipeline job. */
export async function createArticleTask(input: NewTaskInput): Promise<ArticleTask> {
  const mod = getModule(input.moduleKey);
  if (!mod || mod.status !== 'active' || mod.group !== 'Writers') throw new Error(`Unknown writer ${input.moduleKey}`);
  let categoryName: string | null = null;
  if (input.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: input.categoryId } });
    categoryName = cat?.name ?? null;
  }
  const data: Prisma.ArticleTaskCreateInput = {
    moduleKey: mod.key,
    keyword: input.keyword.trim(),
    exampleTitle: input.exampleTitle?.trim() || null,
    secondaryKeywords: JSON.stringify((input.secondaryKeywords ?? []).map((s) => s.trim()).filter(Boolean)),
    targetCountry: input.targetCountry,
    language: input.language,
    website: input.websiteId ? { connect: { id: input.websiteId } } : undefined,
    category: input.categoryId ? { connect: { id: input.categoryId } } : undefined,
    categoryName,
    autoApprove: !!input.autoApprove,
    imagesMode: input.imagesMode ?? null,
    createdById: input.createdById ?? null,
    statusMessage: 'Waiting for the worker',
    stages: {
      create: mod.stages.map((s, i) => ({ key: s.key, label: s.label, position: i })),
    },
  };
  const task = await prisma.articleTask.create({ data });
  await enqueue('article', 'run-pipeline', { mode: 'run' } satisfies ArticleJobData, { taskId: task.id });
  return task;
}

/** Marks a task for cancellation; a waiting job is removed right away. */
export async function cancelTask(taskId: string): Promise<void> {
  await prisma.articleTask.update({ where: { id: taskId }, data: { cancelRequested: true } });
  const waiting = await prisma.queueJob.updateMany({
    where: { taskId, queue: { in: ['article', 'chatgpt'] }, status: 'WAITING' },
    data: { status: 'FAILED', error: 'Cancelled', finishedAt: new Date() },
  });
  const active = await prisma.queueJob.count({ where: { taskId, queue: 'article', status: 'ACTIVE' } });
  if (active === 0) {
    await prisma.articleTask.update({
      where: { id: taskId },
      data: { status: 'CANCELLED', statusMessage: 'Cancelled', cancelRequested: false },
    });
  }
  void waiting;
}

/** Retry from the last completed stage (failed stages are reset to PENDING). */
export async function retryTask(taskId: string): Promise<boolean> {
  await prisma.articleStage.updateMany({ where: { taskId, status: { in: ['FAILED', 'RUNNING'] } }, data: { status: 'PENDING', error: null } });
  await prisma.articleTask.update({
    where: { id: taskId },
    data: { status: 'QUEUED', error: null, cancelRequested: false, loginRequiredFor: null, statusMessage: 'Waiting for the worker' },
  });
  return enqueueArticleRun(taskId, { mode: 'run', reason: 'retry' });
}
