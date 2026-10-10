import { z } from 'zod';
import { ApiError, query, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { enqueue, jobResult } from '@/server/queue';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { escapeHtml } from '@/core/html';

export const dynamic = 'force-dynamic';

/** Whether Google results are available, and the last finished check of an article. */
export const GET = route(async ({ req }) => {
  const googleAvailable = !!process.env.SERPER_API_KEY?.trim();
  const taskId = query(req, 'taskId');
  if (!taskId) return { googleAvailable };
  const last = await prisma.queueJob.findFirst({ where: { queue: 'plagiarism', taskId, status: 'COMPLETED' }, orderBy: { finishedAt: 'desc' } });
  return { googleAvailable, last: last ? { finishedAt: last.finishedAt, report: jobResult(last, null) } : null };
});

const url = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      return /^https?:$/.test(new URL(v).protocol);
    } catch {
      return false;
    }
  }, 'Each address must start with https:// or http://');

const schema = z.object({
  taskId: z.string().max(60).optional().nullable(),
  html: z.string().max(500_000).optional().nullable(),
  text: z.string().max(300_000).optional().nullable(),
  keyword: z.string().trim().max(200).default(''),
  language: z.enum(['English', 'German']).default('English'),
  urls: z.array(url).max(10, 'Add at most 10 addresses.').default([]),
  sources: z.object({ own: z.boolean(), links: z.boolean(), wikipedia: z.boolean(), google: z.boolean() }),
});

/** Runs a check as a "plagiarism" queue job. Nothing in the article changes. */
export const POST = route(async ({ req }) => {
  const body = await readJson(req, schema);
  let html = '';
  let keyword = body.keyword;
  let language = body.language;
  if (body.taskId) {
    const task = await prisma.articleTask.findUnique({ where: { id: body.taskId } });
    html = task?.contentHtml || task?.bodyHtml || '';
    if (!task || !html) throw new ApiError(404, 'That article has no content yet.');
    keyword ||= task.keyword;
    language = task.language === 'German' ? 'German' : 'English';
  } else if (body.html?.trim()) {
    html = sanitizeArticleHtml(body.html);
  } else if (body.text?.trim()) {
    html = body.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (/^>\s?/.test(p) ? `<blockquote><p>${escapeHtml(p.replace(/^>\s?/gm, ''))}</p></blockquote>` : `<p>${escapeHtml(p.replace(/^#+\s*/, '').replace(/\s*\n\s*/g, ' '))}</p>`))
      .join('\n');
  }
  if (!html) throw new ApiError(400, 'Pick an article or paste some text.');
  if (body.sources.google && !process.env.SERPER_API_KEY?.trim()) {
    throw new ApiError(400, 'Google results need SERPER_API_KEY in the .env file (from serper.dev). Restart the app after adding it.');
  }
  if (!Object.values(body.sources).some(Boolean) && !body.urls.length) throw new ApiError(400, 'Choose at least one kind of source.');
  if (body.taskId) {
    const pending = await prisma.queueJob.findFirst({ where: { queue: 'plagiarism', taskId: body.taskId, status: { in: ['WAITING', 'ACTIVE'] } } });
    if (pending) return { jobId: pending.id, existing: true };
  }
  const job = await enqueue('plagiarism', 'plagiarism-check', { taskId: body.taskId ?? null, html, keyword, language, urls: body.urls, sources: body.sources }, { taskId: body.taskId ?? null });
  return { jobId: job.id };
});
