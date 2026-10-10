import type { ArticleStage, QueueJob } from '@prisma/client';
import { prisma } from '@/server/db';
import { jobData } from '@/server/queue';
import { errorMessage, writeLog } from '@/server/log';
import { ConfigError, ConversationLostError, LoginRequiredError, TaskCancelledError, UsageLimitError, isNonRetryable } from '@/server/errors';
import type { ArticleJobData } from '@/server/tasks';
import { parseJson } from '@/lib/json';
import { getPipeline } from '../pipelines/registry';
import { ChatJobError, WorkerStoppingError } from '../chatgpt/client';
import { currentSettings, isStopping, sleep } from '../runtime';
import { createContext, loadTask, type ContextState } from './context';
import type { PipelineContext, PipelineDefinition, PipelineStage, StageOutcome } from './types';

/** Creates missing stage rows and keeps labels/positions in sync with the pipeline. */
export async function ensureStageRows(taskId: string, pipeline: PipelineDefinition): Promise<ArticleStage[]> {
  const rows = await prisma.articleStage.findMany({ where: { taskId } });
  for (let i = 0; i < pipeline.stages.length; i++) {
    const s = pipeline.stages[i]!;
    const row = rows.find((r) => r.key === s.key);
    if (!row) await prisma.articleStage.create({ data: { taskId, key: s.key, label: s.label, position: i } });
    else if (row.label !== s.label || row.position !== i) await prisma.articleStage.update({ where: { id: row.id }, data: { label: s.label, position: i } });
  }
  return prisma.articleStage.findMany({ where: { taskId }, orderBy: { position: 'asc' } });
}

/** Resets the stages of a regeneration plan (stage data is kept: some stages restart from their saved input). */
export async function resetStages(taskId: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  await prisma.articleStage.updateMany({
    where: { taskId, key: { in: keys } },
    data: { status: 'PENDING', attempts: 0, error: null, startedAt: null, completedAt: null },
  });
  if (keys.includes('ARTICLE_APPROVAL')) await prisma.articleTask.update({ where: { id: taskId }, data: { articleApprovedAt: null } });
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 4000 * attempt);
}

type StageResult = 'completed' | 'stopped';

async function runStage(ctx: PipelineContext, stage: PipelineStage, retries: number): Promise<StageResult> {
  const taskId = ctx.task.id;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (isStopping()) return 'stopped';
    ctx.stageKey = stage.key;
    ctx.attempt = attempt;
    await prisma.articleStage.update({
      where: { taskId_key: { taskId, key: stage.key } },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, error: null },
    });
    await prisma.articleTask.update({
      where: { id: taskId },
      data: { status: stage.status, currentStage: stage.key, statusMessage: `${stage.label}${attempt > 1 ? ` (attempt ${attempt})` : ''}…`, error: null, loginRequiredFor: null },
    });
    await ctx.refresh();

    let outcome: StageOutcome;
    try {
      outcome = await stage.run(ctx);
    } catch (err) {
      if (err instanceof WorkerStoppingError || isStopping()) {
        await prisma.articleStage.update({ where: { taskId_key: { taskId, key: stage.key } }, data: { status: 'PENDING' } });
        return 'stopped';
      }
      if (err instanceof LoginRequiredError) {
        await prisma.articleStage.update({ where: { taskId_key: { taskId, key: stage.key } }, data: { status: 'PENDING', error: err.message } });
        await prisma.articleTask.update({ where: { id: taskId }, data: { status: 'LOGIN_REQUIRED', loginRequiredFor: err.service, statusMessage: err.message } });
        await writeLog({ taskId, level: 'WARN', category: 'SESSION', stage: stage.key, message: `Login required (${err.service}): ${err.message} The article continues by itself once the session works again.`, screenshotPath: err.screenshotPath ?? null });
        return 'stopped';
      }
      if (err instanceof TaskCancelledError) {
        await prisma.articleStage.update({ where: { taskId_key: { taskId, key: stage.key } }, data: { status: 'PENDING' } });
        await prisma.articleTask.update({ where: { id: taskId }, data: { status: 'CANCELLED', statusMessage: 'Cancelled', cancelRequested: false } });
        await writeLog({ taskId, category: 'QUEUE', stage: stage.key, message: 'Cancelled.' });
        return 'stopped';
      }
      const message = errorMessage(err);
      const debug = (err as { debug?: unknown }).debug;
      const screenshot = (err as { screenshotPath?: string }).screenshotPath ?? null;
      await writeLog({
        taskId,
        level: 'ERROR',
        category: err instanceof ChatJobError || err instanceof ConversationLostError || err instanceof UsageLimitError ? 'CHATGPT' : 'SYSTEM',
        stage: stage.key,
        message: `${stage.label} failed (attempt ${attempt}/${retries + 1}): ${message}`,
        // The extension's debug snapshot makes a ChatGPT page change diagnosable from the log.
        data: debug ? { extensionDebug: debug } : err instanceof Error ? { stack: err.stack?.split('\n').slice(0, 6).join('\n') } : undefined,
        screenshotPath: screenshot,
      });
      const final = attempt > retries || isNonRetryable(err) || err instanceof ConfigError;
      if (final) {
        await prisma.articleStage.update({ where: { taskId_key: { taskId, key: stage.key } }, data: { status: 'FAILED', error: message } });
        await prisma.articleTask.update({ where: { id: taskId }, data: { status: 'FAILED', error: `${stage.label}: ${message}`, statusMessage: `${stage.label} failed` } });
        return 'stopped';
      }
      await prisma.articleTask.update({ where: { id: taskId }, data: { statusMessage: `${stage.label} failed, retrying in ${Math.round(backoffMs(attempt) / 1000)} s: ${message.slice(0, 160)}` } });
      await sleep(backoffMs(attempt));
      try {
        await ctx.checkCancelled();
      } catch {
        await prisma.articleTask.update({ where: { id: taskId }, data: { status: 'CANCELLED', statusMessage: 'Cancelled', cancelRequested: false } });
        return 'stopped';
      }
      continue;
    }

    if (outcome.outcome === 'paused') {
      await prisma.articleStage.update({ where: { taskId_key: { taskId, key: stage.key } }, data: { status: 'PENDING' } });
      await prisma.articleTask.update({ where: { id: taskId }, data: { status: outcome.status, statusMessage: outcome.message } });
      await writeLog({ taskId, category: 'QUEUE', stage: stage.key, message: outcome.message });
      return 'stopped';
    }

    const data = { ...(outcome.data ?? {}), ...(outcome.reviewReasons ? { __review: outcome.reviewReasons } : {}) };
    await prisma.articleStage.update({
      where: { taskId_key: { taskId, key: stage.key } },
      data: {
        status: outcome.skipped ? 'SKIPPED' : 'COMPLETED',
        prompt: outcome.prompt ?? undefined,
        output: outcome.output ?? undefined,
        outputHtml: outcome.outputHtml ?? undefined,
        data: JSON.stringify(data),
        completedAt: new Date(),
        error: null,
      },
    });
    await prisma.articleTask.update({ where: { id: taskId }, data: { progress: stage.progress, statusMessage: outcome.message ?? `${stage.label} done` } });
    if (outcome.message || outcome.skipped) {
      await writeLog({ taskId, category: 'SYSTEM', stage: stage.key, message: outcome.skipped ? `${stage.label} skipped${outcome.message ? `: ${outcome.message}` : ''}` : outcome.message! });
    }
    return 'completed';
  }
  return 'stopped';
}

/** Collects review reasons from every completed stage. */
export async function collectReviewReasons(taskId: string): Promise<string[]> {
  const rows = await prisma.articleStage.findMany({ where: { taskId }, orderBy: { position: 'asc' } });
  const out: string[] = [];
  for (const r of rows) {
    if (r.status !== 'COMPLETED' && r.status !== 'SKIPPED') continue;
    for (const reason of parseJson<{ __review?: string[] }>(r.data, {}).__review ?? []) if (!out.includes(reason)) out.push(reason);
  }
  return out;
}

/** Runs (or resumes) the pipeline of one article. Completed stages are skipped; each stage retries with backoff. */
export async function runArticleJob(job: QueueJob, _signal: AbortSignal): Promise<unknown> {
  if (!job.taskId) return { skipped: 'no task' };
  const data = jobData<ArticleJobData>(job, { mode: 'run' });
  let task = await loadTask(job.taskId);
  if (!task) return { skipped: 'task deleted' };
  const pipeline = getPipeline(task.moduleKey);
  if (!pipeline) {
    await prisma.articleTask.update({ where: { id: task.id }, data: { status: 'FAILED', error: `No pipeline for ${task.moduleKey}` } });
    return { error: 'no pipeline' };
  }
  if (task.cancelRequested) {
    await prisma.articleTask.update({ where: { id: task.id }, data: { status: 'CANCELLED', statusMessage: 'Cancelled', cancelRequested: false } });
    return { cancelled: true };
  }
  const settings = await currentSettings(0);
  await ensureStageRows(task.id, pipeline);

  if (data.mode === 'regenerate' && data.stageKey) {
    const plan = pipeline.regenerationPlan(data.stageKey, task);
    await resetStages(task.id, plan);
    await writeLog({ taskId: task.id, category: 'QUEUE', stage: data.stageKey, message: `Regenerating ${data.stageKey} (also resets ${plan.filter((k: string) => k !== data.stageKey).join(', ') || 'nothing else'}).` });
  }

  task = (await loadTask(task.id))!;
  await prisma.articleTask.update({ where: { id: task.id }, data: { error: null, loginRequiredFor: null, statusMessage: 'Starting…' } });
  const state: ContextState = { forceNewChat: false, sentThisJob: new Set() };
  const ctx = createContext({ task, settings, pipeline, mode: data.mode, jobId: job.id, state });

  for (const stage of pipeline.stages) {
    if (isStopping()) return { stopped: true };
    const row = await ctx.stageRow(stage.key);
    if (row && (row.status === 'COMPLETED' || row.status === 'SKIPPED')) continue;
    const result = await runStage(ctx, stage, settings.retryAttempts);
    if (result === 'stopped') return { stoppedAt: stage.key };
  }

  ctx.stageKey = '';
  await ctx.refresh();
  if (data.mode === 'regenerate' && data.stageKey && pipeline.afterRegeneration) await pipeline.afterRegeneration(ctx, data.stageKey);
  await pipeline.finalize(ctx);
  return { finished: true };
}
