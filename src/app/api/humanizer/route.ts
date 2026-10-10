import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { enqueue } from '@/server/queue';
import { getPromptContent } from '@/server/prompts';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { escapeHtml } from '@/core/html';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ defaultPrompt: await getPromptContent('ai-humanizer', 'humanizer') }));

const schema = z.object({
  taskId: z.string().max(60).optional().nullable(),
  html: z.string().max(500_000).optional().nullable(),
  text: z.string().max(300_000).optional().nullable(),
  keyword: z.string().trim().max(200).default(''),
  language: z.enum(['English', 'German']).default('English'),
  mode: z.enum(['every', 'flagged']).default('flagged'),
  prompt: z.string().max(50_000).optional().nullable(),
});

/** Runs the humanizer on any saved article or pasted HTML/text as a "humanizer" queue job (nothing is saved). */
export const POST = route(async ({ req }) => {
  const body = await readJson(req, schema);
  let html = '';
  let keyword = body.keyword;
  let language: string = body.language;
  let country: string | undefined;
  if (body.taskId) {
    const task = await prisma.articleTask.findUnique({ where: { id: body.taskId } });
    if (!task?.bodyHtml) throw new ApiError(404, 'That article has no content yet.');
    html = task.bodyHtml;
    keyword ||= task.keyword;
    language = task.language;
    country = task.targetCountry;
  } else if (body.html?.trim()) {
    html = sanitizeArticleHtml(body.html);
  } else if (body.text?.trim()) {
    html = body.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (/^#{2,3}\s/.test(p) ? `<h2>${escapeHtml(p.replace(/^#+\s*/, ''))}</h2>` : `<p>${escapeHtml(p.replace(/\s*\n\s*/g, ' '))}</p>`))
      .join('\n');
  }
  if (!html) throw new ApiError(400, 'Pick an article or paste some text.');
  const job = await enqueue('humanizer', 'humanize-test', { html, keyword, language, country, mode: body.mode, prompt: body.prompt || null });
  return { jobId: job.id };
});
