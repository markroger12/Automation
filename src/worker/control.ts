import type { QueueJob } from '@prisma/client';
import { jobData } from '@/server/queue';
import { openAutomationChrome, restartAutomationChrome } from './automation-chrome';

export type ControlHandler = (data: Record<string, unknown>, job: QueueJob, signal: AbortSignal) => Promise<unknown>;

const handlers = new Map<string, ControlHandler>();

/** Control jobs: browser session actions and other one-off worker actions requested by the dashboard. */
export function registerControlHandler(name: string, handler: ControlHandler): void {
  handlers.set(name, handler);
}

export async function handleControlJob(job: QueueJob, signal: AbortSignal): Promise<unknown> {
  const handler = handlers.get(job.name);
  if (!handler) throw new Error(`Unknown control job "${job.name}"`);
  return handler(jobData<Record<string, unknown>>(job, {}), job, signal);
}

registerControlHandler('open-chatgpt-chrome', async () => openAutomationChrome());
registerControlHandler('restart-chatgpt-chrome', async () => restartAutomationChrome());
