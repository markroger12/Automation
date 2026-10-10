import { ApiError, route } from '@/server/api';
import { prisma } from '@/server/db';
import { parseJson } from '@/lib/json';

export const dynamic = 'force-dynamic';

/** Status of a control/workflow/humanizer job (the dashboard polls this). */
export const GET = route<{ id: string }>(async ({ params }) => {
  const job = await prisma.queueJob.findUnique({ where: { id: params.id } });
  if (!job || job.queue === 'chatgpt') throw new ApiError(404, 'Job not found.');
  return {
    job: {
      id: job.id,
      queue: job.queue,
      name: job.name,
      status: job.status,
      error: job.error,
      result: parseJson<unknown>(job.result, null),
      progress: parseJson<unknown>(job.progress, null),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
  };
});
