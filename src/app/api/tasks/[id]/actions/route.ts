import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { cancelTask, enqueueArticleRun, retryTask } from '@/server/tasks';
import { seoCheckForTask } from '@/server/reassemble';
import { writeLog } from '@/server/log';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('regenerate'), stageKey: z.string().min(2).max(40) }),
  z.object({ action: z.literal('approve-title'), title: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal('send-to-wordpress') }),
  z.object({ action: z.literal('seo-check') }),
]);

export const POST = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await readJson(req, schema);
  const task = await prisma.articleTask.findUnique({ where: { id: params.id }, include: { stages: true } });
  if (!task) throw new ApiError(404, 'Article not found.');

  switch (body.action) {
    case 'cancel':
      await cancelTask(task.id);
      return { ok: true };

    case 'retry':
      if (!['FAILED', 'CANCELLED', 'LOGIN_REQUIRED', 'NEEDS_REVIEW', 'DRAFT_CREATED'].includes(task.status)) throw new ApiError(409, 'Only stopped or finished articles can be retried.');
      await retryTask(task.id);
      return { ok: true };

    case 'regenerate': {
      if (!task.stages.some((s) => s.key === body.stageKey)) throw new ApiError(400, 'Unknown stage.');
      await prisma.articleTask.update({ where: { id: task.id }, data: { status: 'QUEUED', cancelRequested: false, error: null, statusMessage: `Regenerating ${body.stageKey}…` } });
      await enqueueArticleRun(task.id, { mode: 'regenerate', stageKey: body.stageKey });
      await writeLog({ taskId: task.id, category: 'QUEUE', message: `${user.email} asked to regenerate ${body.stageKey}.` });
      return { ok: true };
    }

    case 'approve-title': {
      await prisma.articleTask.update({ where: { id: task.id }, data: { selectedTitle: body.title, titleApprovedAt: new Date() } });
      if (task.status === 'AWAITING_TITLE_APPROVAL') {
        await prisma.articleTask.update({ where: { id: task.id }, data: { status: 'QUEUED', statusMessage: 'Title approved' } });
        await enqueueArticleRun(task.id);
      }
      return { ok: true };
    }

    case 'send-to-wordpress': {
      if (!task.websiteId) throw new ApiError(400, 'Choose a website for this article first.');
      if (!task.bodyHtml) throw new ApiError(400, 'The article has no content yet.');
      const active = await prisma.queueJob.count({ where: { taskId: task.id, queue: 'article', status: 'ACTIVE' } });
      if (active) throw new ApiError(409, 'The article is being written right now.');
      // Re-assemble (checks the internal link again), re-check, then create or update the draft.
      await prisma.articleStage.updateMany({ where: { taskId: task.id, key: { in: ['ASSEMBLY', 'SEO_CHECK', 'ARTICLE_APPROVAL', 'WORDPRESS_DRAFT', 'RANKMATH'] } }, data: { status: 'PENDING', error: null, attempts: 0 } });
      await prisma.articleTask.update({ where: { id: task.id }, data: { articleApprovedAt: new Date(), status: 'QUEUED', cancelRequested: false, error: null, statusMessage: 'Sending to WordPress…' } });
      await enqueueArticleRun(task.id, { mode: 'run', reason: 'send-to-wordpress' });
      return { ok: true };
    }

    case 'seo-check': {
      const report = await seoCheckForTask(task.id);
      return { ok: true, score: report.score };
    }
  }
});
