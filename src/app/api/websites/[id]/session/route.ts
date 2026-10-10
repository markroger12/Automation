import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { enqueue } from '@/server/queue';

const ACTIONS = {
  login: 'profile-login',
  test: 'profile-test',
  refresh: 'profile-refresh',
  open: 'profile-open',
  reset: 'profile-reset',
  'delete-profile': 'profile-delete',
  'sync-categories': 'sync-categories',
  'detect-timezone': 'detect-timezone',
} as const;

const schema = z.object({ action: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...(keyof typeof ACTIONS)[]]) });

/** Session controls run in the worker (only the worker opens browsers). Returns the control job id to poll. */
export const POST = route<{ id: string }>(async ({ req, params }) => {
  const { action } = await readJson(req, schema);
  const website = await prisma.website.findUnique({ where: { id: params.id } });
  if (!website) throw new ApiError(404, 'Website not found.');
  const name = ACTIONS[action];
  const pending = await prisma.queueJob.findFirst({
    where: { queue: 'control', name, status: { in: ['WAITING', 'ACTIVE'] }, data: { contains: website.id } },
  });
  if (pending) return { jobId: pending.id, existing: true };
  const job = await enqueue('control', name, { websiteId: website.id });
  return { jobId: job.id };
});
