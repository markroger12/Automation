import type { QueueJob } from '@prisma/client';

/** Placeholder until the pipeline engine lands (milestone 5). */
export async function runArticleJob(job: QueueJob, _signal: AbortSignal): Promise<unknown> {
  throw new Error(`No pipeline engine yet for task ${job.taskId}`);
}
