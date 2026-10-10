import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { reassembleTask } from '@/server/reassemble';
import { slugify } from '@/core/text';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params }) => {
  const task = await prisma.articleTask.findUnique({
    where: { id: params.id },
    include: {
      website: { select: { id: true, name: true, url: true, language: true, categories: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } },
      category: { select: { id: true, name: true } },
      stages: { orderBy: { position: 'asc' } },
      seoReports: { orderBy: { createdAt: 'desc' }, take: 2 },
      workflowKeyword: true,
      _count: { select: { responses: true, logs: true } },
    },
  });
  if (!task) throw new ApiError(404, 'Article not found.');
  const activeJob = await prisma.queueJob.findFirst({ where: { taskId: task.id, queue: 'article', status: { in: ['WAITING', 'ACTIVE'] } }, select: { id: true, status: true } });
  // Sanitized again before display.
  return { task: { ...task, bodyHtml: task.bodyHtml ? sanitizeArticleHtml(task.bodyHtml) : null, contentHtml: task.contentHtml ? sanitizeArticleHtml(task.contentHtml) : null }, activeJob };
});

const editSchema = z.object({
  selectedTitle: z.string().trim().min(1).max(300).optional(),
  bodyHtml: z.string().max(2_000_000).optional(),
  faqs: z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(3000) })).max(30).optional(),
  quickBio: z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(500) })).max(40).optional(),
  seoTitle: z.string().trim().max(120).optional().nullable(),
  metaDescription: z.string().trim().max(400).optional().nullable(),
  slug: z.string().trim().max(200).optional().nullable(),
  focusKeyword: z.string().trim().max(200).optional().nullable(),
  categoryId: z.string().max(60).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

/** Editor save: stores the edits, sanitizes the HTML and rebuilds the assembled article. */
export const PATCH = route<{ id: string }>(async ({ req, params }) => {
  const input = await readJson(req, editSchema);
  const task = await prisma.articleTask.findUnique({ where: { id: params.id } });
  if (!task) throw new ApiError(404, 'Article not found.');
  let categoryName: string | null | undefined;
  if (input.categoryId !== undefined) {
    if (input.categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: input.categoryId, websiteId: task.websiteId ?? '' } });
      if (!cat) throw new ApiError(400, 'That category does not belong to the article’s website.');
      categoryName = cat.name;
    } else categoryName = null;
  }
  await prisma.articleTask.update({
    where: { id: task.id },
    data: {
      selectedTitle: input.selectedTitle,
      bodyHtml: input.bodyHtml !== undefined ? sanitizeArticleHtml(input.bodyHtml) : undefined,
      faqs: input.faqs ? JSON.stringify(input.faqs) : undefined,
      quickBio: input.quickBio ? JSON.stringify(input.quickBio) : undefined,
      seoTitle: input.seoTitle,
      metaDescription: input.metaDescription,
      slug: input.slug ? slugify(input.slug, 200) : input.slug,
      focusKeyword: input.focusKeyword,
      categoryId: input.categoryId === undefined ? undefined : input.categoryId || null,
      categoryName,
      tags: input.tags ? JSON.stringify(input.tags) : undefined,
    },
  });
  if (task.bodyHtml || input.bodyHtml) await reassembleTask(task.id);
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async ({ params }) => {
  const active = await prisma.queueJob.count({ where: { taskId: params.id, queue: 'article', status: 'ACTIVE' } });
  if (active) throw new ApiError(409, 'The article is being written right now. Cancel it first.');
  await prisma.queueJob.updateMany({ where: { taskId: params.id, status: 'WAITING' }, data: { status: 'FAILED', error: 'Article deleted', finishedAt: new Date() } });
  await prisma.workflowKeyword.updateMany({ where: { taskId: params.id }, data: { taskId: null } });
  await prisma.articleTask.delete({ where: { id: params.id } });
  return { ok: true };
});
