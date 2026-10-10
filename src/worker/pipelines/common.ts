import { prisma } from '@/server/db';
import { parseJson, stringArray } from '@/lib/json';
import { htmlToMarkdown, markdownToHtml } from '@/core/markdown';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { cleanArticleMarkdown } from '@/core/cleanup';
import { assembleArticle, articleOutline, type BodyImage } from '@/core/assembly';
import { buildSeoFields } from '@/core/seo-fields';
import { seoCheck } from '@/core/seo-check';
import { suggestTags } from '@/core/tags';
import { htmlToText } from '@/core/html';
import { L } from '@/core/language';
import type { BioRow } from '@/core/parsers/quick-bio';
import type { Faq } from '@/core/parsers/faqs';
import { collectReviewReasons } from '../engine/run-job';
import type { PipelineContext, PipelineStage, StageOutcome } from '../engine/types';
import { resolveInternalLink } from './stages/internal-link';
import { assembleTaskContent, mediaUrl, seoCheckForTask, type ImagesData } from '@/server/reassemble';

export type { ImagesData };
export { mediaUrl };

export function bodyMarkdown(ctx: PipelineContext): string {
  return ctx.task.bodyHtml ? htmlToMarkdown(ctx.task.bodyHtml) : '';
}

/** Cleans a Markdown article and stores it as the article body. */
export async function setBodyFromMarkdown(ctx: PipelineContext, md: string, opts: { dropTitle?: boolean } = {}): Promise<{ markdown: string; html: string }> {
  const markdown = cleanArticleMarkdown(md, opts);
  const html = sanitizeArticleHtml(markdownToHtml(markdown));
  await ctx.update({ bodyHtml: html });
  return { markdown, html };
}

export function wordRange(maxWords: number): string {
  const min = Math.round((maxWords * 0.85) / 50) * 50;
  return `${min.toLocaleString('en-US')}–${maxWords.toLocaleString('en-US')}`;
}

/** Variables every prompt can use. */
export async function baseVariables(ctx: PipelineContext, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const t = ctx.task;
  const s = ctx.settings;
  const rows = s.quickBioRows;
  return {
    keyword: t.keyword,
    example_title: t.exampleTitle ?? '',
    selected_title: t.selectedTitle ?? t.recommendedTitle ?? t.exampleTitle ?? t.keyword,
    secondary_keywords: stringArray(t.secondaryKeywords).join(', '),
    country: t.targetCountry || s.targetCountry,
    language: ctx.language,
    category: t.categoryName ?? t.category?.name ?? '',
    categories: (t.website?.categories ?? []).map((c) => c.name).join('\n'),
    research: (await ctx.stageOutput('RESEARCH')) ?? '',
    article: (await ctx.stageOutput('LONG_ARTICLE')) ?? '',
    final_article: bodyMarkdown(ctx),
    max_words: ctx.maxWords(),
    word_range: wordRange(ctx.maxWords()),
    min_keyword_occurrences: s.minKeywordOccurrences,
    max_keyword_occurrences: s.maxKeywordOccurrences,
    faq_count: s.faqCount,
    bio_rows_range: `${Math.max(3, rows - 1)}–${rows + 1}`,
    seo_title: t.seoTitle ?? '',
    meta_description: t.metaDescription ?? '',
    link_count: Math.min(7, Math.max(5, s.maxExternalLinks + 2)),
    wikipedia_site: L[ctx.language].wikipedia,
    ...extra,
  };
}

// ---------- gates ----------

export function titleApprovalGate(): PipelineStage {
  return {
    key: 'TITLE_APPROVAL',
    label: 'Title approval',
    kind: 'gate',
    status: 'AWAITING_TITLE_APPROVAL',
    progress: 10,
    async run(ctx): Promise<StageOutcome> {
      const t = ctx.task;
      if (!t.autoApprove && ctx.settings.manualTitleApproval && !t.titleApprovedAt) {
        return { outcome: 'paused', status: 'AWAITING_TITLE_APPROVAL', message: 'Pick a title on the article page to continue.' };
      }
      if (!t.selectedTitle) await ctx.update({ selectedTitle: t.recommendedTitle ?? t.exampleTitle ?? t.keyword });
      return { outcome: 'completed', output: ctx.task.selectedTitle, message: t.autoApprove || !ctx.settings.manualTitleApproval ? 'Title chosen automatically' : 'Title approved' };
    },
  };
}

export function articleApprovalGate(): PipelineStage {
  return {
    key: 'ARTICLE_APPROVAL',
    label: 'Article approval',
    kind: 'gate',
    status: 'AWAITING_ARTICLE_APPROVAL',
    progress: 85,
    async run(ctx): Promise<StageOutcome> {
      const t = ctx.task;
      if (t.autoApprove || t.articleApprovedAt) return { outcome: 'completed', message: 'Article approved' };
      if (ctx.settings.manualArticleApproval) return { outcome: 'paused', status: 'AWAITING_ARTICLE_APPROVAL', message: 'Review the article and press Send to WordPress.' };
      if (!ctx.settings.autoSendToWordPress) return { outcome: 'paused', status: 'AWAITING_ARTICLE_APPROVAL', message: 'Automatic sending is off: press Send to WordPress.' };
      if (ctx.mode === 'regenerate' && t.wpPostId) return { outcome: 'paused', status: 'AWAITING_ARTICLE_APPROVAL', message: 'The article changed after its draft was saved: press Send to WordPress to update the draft.' };
      return { outcome: 'completed', message: 'Sending to WordPress automatically' };
    },
  };
}

// ---------- assembly & SEO ----------

export type AssemblyOptions = {
  /** SEO values ChatGPT already gave (Tigram header lines, Writer 2.0) */
  givenSeo?: (ctx: PipelineContext) => Promise<{ seoTitle?: string | null; metaDescription?: string | null; slug?: string | null; tags?: string[] }>;
};

export function assemblyStage(opts: AssemblyOptions = {}): PipelineStage {
  return {
    key: 'ASSEMBLY',
    label: 'Assembly',
    kind: 'local',
    status: 'SEO_CHECKING',
    progress: 80,
    async run(ctx): Promise<StageOutcome> {
      const t = ctx.task;
      if (!t.bodyHtml) throw new Error('There is no article body to assemble.');
      const quickBio = parseJson<BioRow[]>(t.quickBio, []);
      const images = (await ctx.stageData<ImagesData>('IMAGES')) ?? null;
      const link = await resolveInternalLink(ctx);
      const contentHtml = assembleTaskContent(t, images, link);
      const fromChat = opts.givenSeo ? await opts.givenSeo(ctx) : {};
      // Values the person edited since the last assembly are kept.
      const last = (await ctx.stageData<{ autoSeo?: { seoTitle?: string; metaDescription?: string; slug?: string } }>('ASSEMBLY'))?.autoSeo;
      const edited = (field: 'seoTitle' | 'metaDescription' | 'slug') => !!t[field] && !!last && t[field] !== last[field];
      const given = {
        seoTitle: edited('seoTitle') ? t.seoTitle : fromChat.seoTitle,
        metaDescription: edited('metaDescription') ? t.metaDescription : fromChat.metaDescription,
        slug: edited('slug') ? t.slug : fromChat.slug,
      };
      const intro = articleOutline(t.bodyHtml).intro.map((b) => b.text).join(' ');
      const title = t.selectedTitle ?? t.recommendedTitle ?? t.exampleTitle ?? t.keyword;
      const seo = buildSeoFields({ title, keyword: t.keyword, kind: ctx.kind, language: ctx.language, introText: intro, given });
      const existingTags = stringArray(t.tags);
      const tags = existingTags.length ? existingTags : fromChat.tags?.length ? fromChat.tags : suggestTags(t.keyword, { secondary: stringArray(t.secondaryKeywords), quickBio });
      await ctx.update({
        contentHtml,
        selectedTitle: seo.title,
        seoTitle: seo.seoTitle,
        metaDescription: seo.metaDescription,
        slug: seo.slug,
        focusKeyword: t.focusKeyword || seo.focusKeyword,
        tags: JSON.stringify(tags.slice(0, 12)),
      });
      const reasons: string[] = [];
      if (link === null && t.website) reasons.push('No internal link: the previous article of this website has no title or URL yet.');
      return {
        outcome: 'completed',
        outputHtml: contentHtml,
        data: { internalLink: link, words: htmlToText(contentHtml).split(/\s+/).length, autoSeo: { seoTitle: seo.seoTitle, metaDescription: seo.metaDescription, slug: seo.slug } },
        reviewReasons: reasons,
        message: `Article assembled${link ? ` (internal link to "${link.title}")` : ''}`,
      };
    },
  };
}

export function seoCheckStage(): PipelineStage {
  return {
    key: 'SEO_CHECK',
    label: 'SEO check',
    kind: 'local',
    status: 'SEO_CHECKING',
    progress: 84,
    async run(ctx): Promise<StageOutcome> {
      const report = await runSeoCheck(ctx);
      const reasons = report.score < ctx.settings.seoReviewThreshold ? [`SEO Readiness Score ${report.score} is below ${ctx.settings.seoReviewThreshold}: ${report.checks.filter((c) => !c.passed).map((c) => c.label).slice(0, 5).join('; ')}`] : [];
      return { outcome: 'completed', data: { score: report.score }, reviewReasons: reasons, message: `SEO Readiness Score ${report.score}` };
    },
  };
}

export async function runSeoCheck(ctx: PipelineContext) {
  const report = await seoCheckForTask(ctx.task.id);
  await ctx.refresh();
  return report;
}

/** DRAFT_CREATED, or NEEDS_REVIEW with the reasons collected from every stage. */
export async function defaultFinalize(ctx: PipelineContext): Promise<void> {
  const reasons = await collectReviewReasons(ctx.task.id);
  const t = await ctx.refresh();
  if (!t.website) reasons.push('No website selected: the article was not sent to WordPress.');
  else if (!t.wpPostId) reasons.push('The WordPress draft was not created.');
  const status = reasons.length ? 'NEEDS_REVIEW' : 'DRAFT_CREATED';
  await ctx.update({
    status,
    progress: 100,
    currentStage: null,
    reviewReasons: JSON.stringify(reasons),
    statusMessage: status === 'DRAFT_CREATED' ? 'Draft saved in WordPress' : `Needs review: ${reasons[0]}`,
  });
  await ctx.log.info(status === 'DRAFT_CREATED' ? 'Finished: WordPress draft created.' : `Finished with ${reasons.length} review reason(s).`, { reasons });
}

/** Stages after the article text: regenerating any of them re-assembles, re-checks and (if a draft exists) re-sends. */
export function tail(task: { wpPostId: number | null }): string[] {
  return ['ASSEMBLY', 'SEO_CHECK', ...(task.wpPostId ? ['ARTICLE_APPROVAL', 'WORDPRESS_DRAFT', 'RANKMATH'] : [])];
}
