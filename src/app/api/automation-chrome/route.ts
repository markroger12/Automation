import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { enqueue, hasPendingJob } from '@/server/queue';

const schema = z.object({ action: z.enum(['open', 'restart']) });

/**
 * Opens or restarts the Automation Chrome through a worker control job (only the worker starts browsers).
 * A restart fails every running ChatGPT prompt, so it is refused while one is ACTIVE.
 */
export const POST = route(async ({ req }) => {
  const { action } = await readJson(req, schema);
  if (action === 'restart') {
    const active = await prisma.queueJob.count({ where: { queue: 'chatgpt', status: 'ACTIVE' } });
    if (active > 0) throw new ApiError(409, `${active} ChatGPT prompt(s) are running. Restart when they are finished.`);
  }
  const name = action === 'open' ? 'open-chatgpt-chrome' : 'restart-chatgpt-chrome';
  if (await hasPendingJob('control', name)) return { ok: true, queued: false, message: 'Already requested.' };
  const job = await enqueue('control', name, { manual: true });
  return { ok: true, queued: true, jobId: job.id };
});
