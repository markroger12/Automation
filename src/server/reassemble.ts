import type { ArticleTask, Website } from '@prisma/client';
import { prisma } from './db';
import { getSettings } from './settings';
import { parseJson, stringArray } from '@/lib/json';
import { assembleArticle, type BodyImage, type InternalLink } from '@/core/assembly';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { seoCheck } from '@/core/seo-check';
import { L, asLang } from '@/core/language';
import type { BioRow } from '@/core/parsers/quick-bio';
import type { Faq } from '@/core/parsers/faqs';
import { getModule } from '@/modules/registry';

export type ImagesData = {
  featured: { path: string; alt: string } | null;
  body: { key: string; path: string; alt: string }[];
};

export function mediaUrl(relPath: string): string {
  return `/api/media/${relPath.replace(/^media\//, '')}`;
}

export function moduleKind(moduleKey: string): 'celebrity' | 'tigram' {
  return getModule(moduleKey)?.kind ?? 'celebrity';
}

export function moduleMaxWords(moduleKey: string, settingsMax: number): number {
  return getModule(moduleKey)?.maxWords ?? settingsMax;
}

/** The assembled article (Quick Bio, FAQs, images, internal link) from the task's current fields. */
export function assembleTaskContent(
  task: Pick<ArticleTask, 'bodyHtml' | 'keyword' | 'language' | 'quickBio' | 'faqs' | 'moduleKey'> & { website?: Pick<Website, 'internalLinkText'> | null },
  images: ImagesData | null,
  link: { url: string; title: string } | null,
): string {
  const language = asLang(task.language);
  const linkText = task.website?.internalLinkText || L[language].internalLinkText;
  const bodyImages: BodyImage[] = (images?.body ?? []).map((b) => ({ key: b.key, src: mediaUrl(b.path), alt: b.alt }));
  const internalLink: InternalLink | null = link ? { text: linkText, url: link.url, title: link.title } : null;
  return sanitizeArticleHtml(
    assembleArticle({
      bodyHtml: task.bodyHtml ?? '',
      keyword: task.keyword,
      language,
      kind: moduleKind(task.moduleKey),
      quickBio: parseJson<BioRow[]>(task.quickBio, []),
      faqs: parseJson<Faq[]>(task.faqs, []),
      bodyImages,
      internalLinkText: linkText,
      internalLink,
    }),
  );
}

/** Internal SEO check of the task's current state; stores an SEOReport and the metrics. */
export async function seoCheckForTask(taskId: string) {
  const t = await prisma.articleTask.findUniqueOrThrow({ where: { id: taskId }, include: { category: true } });
  const settings = await getSettings();
  const report = seoCheck({
    keyword: t.focusKeyword || t.keyword,
    title: t.selectedTitle ?? t.keyword,
    seoTitle: t.seoTitle ?? '',
    metaDescription: t.metaDescription ?? '',
    slug: t.slug ?? '',
    contentHtml: t.contentHtml ?? t.bodyHtml ?? '',
    kind: moduleKind(t.moduleKey),
    maxWords: moduleMaxWords(t.moduleKey, settings.maxArticleWordCount),
    minKeyword: settings.minKeywordOccurrences,
    maxKeyword: settings.maxKeywordOccurrences,
    hasFaqs: parseJson<Faq[]>(t.faqs, []).length > 0,
    hasQuickBio: parseJson<BioRow[]>(t.quickBio, []).length > 0,
    category: t.categoryName ?? t.category?.name ?? null,
    tags: stringArray(t.tags),
  });
  await prisma.sEOReport.create({ data: { taskId: t.id, source: 'INTERNAL', score: report.score, checks: JSON.stringify(report.checks), metrics: JSON.stringify(report.metrics) } });
  await prisma.articleTask.update({
    where: { id: t.id },
    data: {
      seoScore: report.score,
      wordCount: report.metrics.wordCount,
      keywordCount: report.metrics.keywordCount,
      keywordDensity: report.metrics.keywordDensity,
      h2Count: report.metrics.h2Count,
      h3Count: report.metrics.h3Count,
    },
  });
  return report;
}

/** Rebuilds contentHtml after an edit (same images and internal link as the last assembly) and re-checks SEO. */
export async function reassembleTask(taskId: string): Promise<void> {
  const task = await prisma.articleTask.findUniqueOrThrow({ where: { id: taskId }, include: { website: true, stages: { where: { key: { in: ['IMAGES', 'ASSEMBLY'] } } } } });
  if (!task.bodyHtml) return;
  const images = parseJson<ImagesData | null>(task.stages.find((s) => s.key === 'IMAGES')?.data, null);
  const link = parseJson<{ internalLink?: { url: string; title: string } | null }>(task.stages.find((s) => s.key === 'ASSEMBLY')?.data, {}).internalLink ?? null;
  const contentHtml = assembleTaskContent(task, images, link);
  await prisma.articleTask.update({ where: { id: taskId }, data: { contentHtml } });
  await seoCheckForTask(taskId);
}
