import type { ArticleTask } from '@prisma/client';
import { prisma } from '@/server/db';
import { slugify } from '@/core/text';
import type { PipelineContext } from '../../engine/types';
import { readFeed, normTitle } from '../../links/feed';
import { sleep, isStopping } from '../../runtime';

export type ResolvedLink = { url: string; title: string };

const TITLE_WAIT_MS = 10 * 60_000;

/** The previous article of the same website: by workflow publish time, otherwise by creation order. */
export async function findPreviousArticle(task: Pick<ArticleTask, 'id' | 'websiteId' | 'createdAt'>): Promise<ArticleTask | null> {
  if (!task.websiteId) return null;
  const wk = await prisma.workflowKeyword.findUnique({ where: { taskId: task.id } });
  if (wk?.publishAt) {
    const prev = await prisma.workflowKeyword.findFirst({
      where: { workflowId: wk.workflowId, publishAt: { lt: wk.publishAt }, taskId: { not: null }, state: { notIn: ['FAILED', 'SKIPPED'] } },
      orderBy: { publishAt: 'desc' },
      include: { task: true },
    });
    if (prev?.task && !['FAILED', 'CANCELLED'].includes(prev.task.status)) return prev.task;
  }
  return prisma.articleTask.findFirst({
    where: { websiteId: task.websiteId, id: { not: task.id }, createdAt: { lt: task.createdAt }, status: { notIn: ['FAILED', 'CANCELLED'] } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Internal link for the last line: previous article (real URL from /feed/ once published), or the site's newest post. */
export async function resolveInternalLink(ctx: PipelineContext): Promise<ResolvedLink | null> {
  const website = ctx.task.website;
  if (!website) return null;
  const site = website.url.replace(/\/+$/, '');
  let prev = await findPreviousArticle(ctx.task);

  if (prev && !prev.selectedTitle) {
    // The previous article is still being written: wait up to 10 minutes for its title.
    const started = Date.now();
    await ctx.setMessage('Assembly: waiting for the previous article’s title (internal link)…');
    while (prev && !prev.selectedTitle && Date.now() - started < TITLE_WAIT_MS && !isStopping()) {
      if (['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'].includes(prev.status)) break;
      await sleep(15_000);
      await ctx.checkCancelled();
      prev = await prisma.articleTask.findUnique({ where: { id: prev.id } });
    }
  }

  const feed = await readFeed(site);
  if (prev?.selectedTitle) {
    const title = prev.selectedTitle;
    const item = feed.find((i) => normTitle(i.title) === normTitle(title));
    const url = item?.link ?? (prev.wpPostUrl && !/[?&]p=\d+/.test(prev.wpPostUrl) ? prev.wpPostUrl : `${site}/${prev.slug || slugify(title)}/`);
    return { url, title };
  }
  // First article of the website: link to the newest post on the site.
  const newest = [...feed].sort((a, b) => b.pubDate - a.pubDate)[0];
  return newest ? { url: newest.link, title: newest.title.replace(/&amp;/g, '&') } : null;
}
