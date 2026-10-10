import type { ArticleTask } from '@prisma/client';
import { parseTitles } from '@/core/parsers/titles';
import { parseFaqs } from '@/core/parsers/faqs';
import { parseQuickBio } from '@/core/parsers/quick-bio';
import { countWords } from '@/core/text';
import type { PipelineContext, PipelineDefinition, PipelineStage, StageOutcome } from '../engine/types';
import { articleApprovalGate, assemblyStage, baseVariables, bodyMarkdown, defaultFinalize, seoCheckStage, setBodyFromMarkdown, tail, titleApprovalGate } from './common';
import { externalLinksStage } from './stages/external-links';
import { celebrityImagesStage } from './stages/images';
import { humanizeStage } from './stages/humanize';
import { rankMathStage, wordpressDraftStage } from './stages/wordpress';

const titles: PipelineStage = {
  key: 'TITLES',
  label: 'Titles',
  kind: 'chatgpt',
  status: 'GENERATING_TITLES',
  progress: 8,
  async run(ctx): Promise<StageOutcome> {
    const a = await ctx.askChatGPT('TITLES', 'title', {}, { label: 'Titles' });
    const { options, recommended } = parseTitles(a.markdown);
    if (!recommended) throw new Error('The answer has no title ideas (no "Recommended Title:" line).');
    await ctx.update({ titleOptions: JSON.stringify(options), recommendedTitle: recommended, selectedTitle: recommended, titleApprovedAt: null });
    return { outcome: 'completed', prompt: a.prompt, output: a.markdown, outputHtml: a.html, data: { options, recommended }, message: `Recommended title: ${recommended}` };
  },
};

const research: PipelineStage = {
  key: 'RESEARCH',
  label: 'Research',
  kind: 'chatgpt',
  status: 'RESEARCHING',
  progress: 20,
  async run(ctx) {
    const a = await ctx.askChatGPT('RESEARCH', 'research', {}, { label: 'Research' });
    if (countWords(a.markdown) < 80) throw new Error('The research answer is too short.');
    return { outcome: 'completed', prompt: a.prompt, output: a.markdown, outputHtml: a.html };
  },
};

const longArticle: PipelineStage = {
  key: 'LONG_ARTICLE',
  label: 'Long article',
  kind: 'chatgpt',
  status: 'WRITING_ARTICLE',
  progress: 32,
  async run(ctx) {
    const a = await ctx.askChatGPT('LONG_ARTICLE', 'long_article', {}, { label: 'Long article' });
    if (countWords(a.markdown) < 300) throw new Error(`The long article has only ${countWords(a.markdown)} words.`);
    return { outcome: 'completed', prompt: a.prompt, output: a.markdown, outputHtml: a.html, message: `${countWords(a.markdown)} words` };
  },
};

const finalArticle: PipelineStage = {
  key: 'FINAL_ARTICLE',
  label: 'Final article',
  kind: 'chatgpt',
  status: 'OPTIMIZING',
  progress: 42,
  async run(ctx) {
    const a = await ctx.askChatGPT('FINAL_ARTICLE', 'final_article', {}, { label: 'Final article' });
    const body = await setBodyFromMarkdown(ctx, a.markdown);
    const words = countWords(body.markdown);
    if (words < 250) throw new Error(`The final article has only ${words} words.`);
    return { outcome: 'completed', prompt: a.prompt, output: body.markdown, outputHtml: body.html, message: `${words} words` };
  },
};

const faqs: PipelineStage = {
  key: 'FAQS',
  label: 'FAQs',
  kind: 'chatgpt',
  status: 'GENERATING_FAQS',
  progress: 48,
  async run(ctx) {
    const a = await ctx.askChatGPT('FAQS', 'faq', {}, { label: 'FAQs' });
    const list = parseFaqs(a.markdown, ctx.settings.faqCount);
    if (!list.length) throw new Error('No FAQs found in the answer (expected a question line followed by an answer line).');
    await ctx.update({ faqs: JSON.stringify(list) });
    return { outcome: 'completed', prompt: a.prompt, output: a.markdown, outputHtml: a.html, message: `${list.length} FAQs` };
  },
};

const quickBio: PipelineStage = {
  key: 'QUICK_BIO',
  label: 'Quick Bio',
  kind: 'chatgpt',
  status: 'GENERATING_BIO_TABLE',
  progress: 54,
  async run(ctx) {
    const a = await ctx.askChatGPT('QUICK_BIO', 'quick_bio', {}, { label: 'Quick Bio' });
    const rows = parseQuickBio(a.html.includes('<table') ? a.html : a.markdown, 30);
    if (rows.length < 3) throw new Error('The Quick Bio table could not be read.');
    await ctx.update({ quickBio: JSON.stringify(rows) });
    return { outcome: 'completed', prompt: a.prompt, output: a.markdown, outputHtml: a.html, message: `${rows.length} rows` };
  },
};

const ORDER = ['TITLES', 'TITLE_APPROVAL', 'RESEARCH', 'LONG_ARTICLE', 'FINAL_ARTICLE', 'FAQS', 'QUICK_BIO', 'EXTERNAL_LINKS', 'IMAGES', 'HUMANIZE', 'ASSEMBLY', 'SEO_CHECK', 'ARTICLE_APPROVAL', 'WORDPRESS_DRAFT', 'RANKMATH'];

/** Stages to reset when one is regenerated (the stage itself plus everything that depends on it). */
export function celebrityRegenerationPlan(stageKey: string, task: Pick<ArticleTask, 'wpPostId'>): string[] {
  const from = (key: string) => ORDER.slice(ORDER.indexOf(key)).filter((k) => k !== 'TITLE_APPROVAL' || key === 'TITLES');
  switch (stageKey) {
    case 'TITLES':
      return ['TITLES', 'TITLE_APPROVAL', ...tail(task)];
    case 'RESEARCH':
    case 'LONG_ARTICLE':
      return from(stageKey).filter((k) => !['WORDPRESS_DRAFT', 'RANKMATH', 'ARTICLE_APPROVAL', 'IMAGES'].includes(k)).concat(task.wpPostId ? ['ARTICLE_APPROVAL', 'WORDPRESS_DRAFT', 'RANKMATH'] : []);
    case 'FINAL_ARTICLE':
      return ['FINAL_ARTICLE', 'EXTERNAL_LINKS', 'HUMANIZE', ...tail(task)];
    case 'FAQS':
    case 'QUICK_BIO':
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
    case 'RANKMATH':
      return ['RANKMATH'];
    default:
      return [stageKey];
  }
}

/** Restores the article context in a new chat when the saved chat is lost. */
export async function celebrityPrimer(ctx: PipelineContext): Promise<string | null> {
  const research = (await ctx.stageOutput('RESEARCH')) ?? '';
  const article = bodyMarkdown(ctx) || (await ctx.stageOutput('LONG_ARTICLE')) || '';
  if (!research && !article) return null;
  const parts = [
    `We are writing a biography article about "${ctx.task.keyword}"${ctx.task.selectedTitle ? ` titled "${ctx.task.selectedTitle}"` : ''}. The earlier chat is no longer available, so here is what we have so far.`,
  ];
  if (research) parts.push(`Research collected earlier:\n${research.slice(0, 7000)}`);
  if (article) parts.push(`The current article:\n${article.slice(0, 9000)}`);
  parts.push('Use this information for the next task.');
  return parts.join('\n\n');
}

export const celebrityPipeline: PipelineDefinition = {
  moduleKey: 'celebrity-writer',
  kind: 'celebrity',
  stages: [
    titles,
    titleApprovalGate(),
    research,
    longArticle,
    finalArticle,
    faqs,
    quickBio,
    externalLinksStage(60),
    celebrityImagesStage(68),
    humanizeStage(76),
    assemblyStage(),
    seoCheckStage(),
    articleApprovalGate(),
    wordpressDraftStage(),
    rankMathStage(),
  ],
  maxWords: (s) => s.maxArticleWordCount,
  regenerationPlan: celebrityRegenerationPlan,
  variables: (ctx, extra) => baseVariables(ctx, extra),
  contextPrimer: (ctx) => celebrityPrimer(ctx),
  finalize: defaultFinalize,
};
