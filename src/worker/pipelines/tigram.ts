import type { ArticleTask } from '@prisma/client';
import { prisma } from '@/server/db';
import { stringArray } from '@/lib/json';
import { faqsFromArticle, parseCategoryAnswer, parseTigramHeader } from '@/core/parsers/tigram';
import { countWords, slugify, titleCaseKeyword } from '@/core/text';
import type { PipelineContext, PipelineDefinition, PipelineStage, StageOutcome } from '../engine/types';
import { articleApprovalGate, assemblyStage, baseVariables, bodyMarkdown, defaultFinalize, seoCheckStage, setBodyFromMarkdown, tail } from './common';
import { externalLinksStage } from './stages/external-links';
import { tigramImagesStage } from './stages/images';
import { humanizeStage } from './stages/humanize';
import { rankMathStage, wordpressDraftStage } from './stages/wordpress';

type ArticleData = { seoTitle?: string | null; metaDescription?: string | null; slug?: string | null };

const article: PipelineStage = {
  key: 'ARTICLE',
  label: 'Article',
  kind: 'chatgpt',
  status: 'WRITING_ARTICLE',
  progress: 30,
  async run(ctx): Promise<StageOutcome> {
    const a = await ctx.askChatGPT('ARTICLE', 'article', {}, { label: 'Article' });
    const header = parseTigramHeader(a.markdown);
    const body = await setBodyFromMarkdown(ctx, header.body, { dropTitle: true });
    const words = countWords(body.markdown);
    if (words < 300) throw new Error(`The article has only ${words} words.`);
    const title = ctx.task.exampleTitle || header.h1 || header.seoTitle || titleCaseKeyword(ctx.task.keyword);
    const faqs = faqsFromArticle(body.markdown);
    const tags = [titleCaseKeyword(ctx.task.keyword), ...stringArray(ctx.task.secondaryKeywords)].slice(0, 10);
    await ctx.update({
      selectedTitle: title,
      recommendedTitle: title,
      titleOptions: JSON.stringify([...new Set([title, header.h1, header.seoTitle].filter(Boolean))]),
      slug: header.slug ? slugify(header.slug) : slugify(ctx.task.keyword),
      faqs: JSON.stringify(faqs),
      tags: JSON.stringify(tags),
    });
    const data: ArticleData = { seoTitle: header.seoTitle, metaDescription: header.metaDescription, slug: header.slug };
    return { outcome: 'completed', prompt: a.prompt, output: body.markdown, outputHtml: body.html, data, message: `${words} words, ${faqs.length} FAQs` };
  },
};

const category: PipelineStage = {
  key: 'CATEGORY',
  label: 'Category',
  kind: 'chatgpt',
  status: 'OPTIMIZING',
  progress: 36,
  async run(ctx): Promise<StageOutcome> {
    const t = ctx.task;
    if (t.categoryId) return { outcome: 'completed', skipped: true, message: `Category chosen by you: ${t.categoryName ?? t.category?.name}` };
    const cats = t.website?.categories ?? [];
    if (!cats.length) return { outcome: 'completed', skipped: true, message: 'The website has no synced categories', reviewReasons: t.website ? ['No categories synced for this website (Websites → Sync Categories).'] : [] };
    const a = await ctx.askChatGPT('CATEGORY', 'category', {}, { label: 'Category', noLanguageLine: true });
    let pick = parseCategoryAnswer(a.markdown, cats);
    let note = '';
    if (!pick) {
      pick = cats.find((c) => c.id === t.website?.defaultCategoryId) ?? null;
      note = pick ? ` ChatGPT's answer did not match a category; using the default "${pick.name}".` : '';
    }
    if (pick) await prisma.articleTask.update({ where: { id: t.id }, data: { categoryId: pick.id, categoryName: pick.name } });
    return {
      outcome: 'completed',
      prompt: a.prompt,
      output: a.markdown,
      reviewReasons: pick ? [] : ['ChatGPT did not pick one of the website’s categories.'],
      message: pick ? `Category: ${pick.name}.${note}` : 'No category matched',
    };
  },
};

export function tigramRegenerationPlan(stageKey: string, task: Pick<ArticleTask, 'wpPostId'>): string[] {
  switch (stageKey) {
    case 'ARTICLE':
      return ['ARTICLE', 'EXTERNAL_LINKS', 'HUMANIZE', ...tail(task)];
    case 'CATEGORY':
    case 'IMAGES':
      return [stageKey, ...tail(task)];
    case 'EXTERNAL_LINKS':
      return ['EXTERNAL_LINKS', 'HUMANIZE', ...tail(task)];
    case 'HUMANIZE':
      return ['HUMANIZE', ...tail(task)];
    case 'ASSEMBLY':
      return tail(task);
    case 'SEO_CHECK':
      return ['SEO_CHECK'];
    case 'WORDPRESS_DRAFT':
      return ['WORDPRESS_DRAFT', 'RANKMATH'];
    default:
      return [stageKey];
  }
}

async function primer(ctx: PipelineContext): Promise<string | null> {
  const body = bodyMarkdown(ctx);
  if (!body) return null;
  return `We are writing an article about "${ctx.task.keyword}". The earlier chat is no longer available; this is the article so far:\n\n${body.slice(0, 12000)}\n\nUse it for the next task.`;
}

export const tigramPipeline: PipelineDefinition = {
  moduleKey: 'tigram-writer',
  kind: 'tigram',
  stages: [article, category, externalLinksStage(46), tigramImagesStage(62), humanizeStage(74), assemblyStage({ givenSeo: async (ctx) => (await ctx.stageData<ArticleData>('ARTICLE')) ?? {} }), seoCheckStage(), articleApprovalGate(), wordpressDraftStage(), rankMathStage()],
  maxWords: (s) => s.maxArticleWordCount,
  regenerationPlan: tigramRegenerationPlan,
  variables: (ctx, extra) => baseVariables(ctx, extra),
  contextPrimer: primer,
  finalize: defaultFinalize,
};
