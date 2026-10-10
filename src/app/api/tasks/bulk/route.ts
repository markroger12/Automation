import { z } from 'zod';
import { readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { cancelTask, retryTask } from '@/server/tasks';

const schema = z.object({ ids: z.array(z.string().max(60)).min(1).max(1000), action: z.enum(['cancel', 'retry', 'delete']) });

export const POST = route(async ({ req }) => {
  const { ids, action } = await readJson(req, schema);
  let done = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    const task = await prisma.articleTask.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!task) continue;
    if (action === 'cancel') {
      if (['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'].includes(task.status)) continue;
      await cancelTask(id);
    } else if (action === 'retry') {
      if (!['FAILED', 'CANCELLED', 'LOGIN_REQUIRED'].includes(task.status)) {
        skipped.push(id);
        continue;
      }
      await retryTask(id);
    } else {
      const active = await prisma.queueJob.count({ where: { taskId: id, queue: 'article', status: 'ACTIVE' } });
      if (active) {
        skipped.push(id);
        continue;
      }
      await prisma.queueJob.updateMany({ where: { taskId: id, status: 'WAITING' }, data: { status: 'FAILED', error: 'Article deleted', finishedAt: new Date() } });
      await prisma.workflowKeyword.updateMany({ where: { taskId: id }, data: { taskId: null } });
      await prisma.articleTask.delete({ where: { id } });
    }
    done++;
  }
  return { done, skipped: skipped.length };
});
