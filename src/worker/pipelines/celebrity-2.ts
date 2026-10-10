import type { ArticleTask } from '@prisma/client';
import { writeLog } from '@/server/log';
import { parseWriter2 } from '@/core/parsers/writer2';
import { countWords, slugify, titleCaseKeyword } from '@/core/text';
import { suggestTags } from '@/core/tags';
import { stringArray } from '@/lib/json';
import type { PipelineContext, PipelineDefinition, PipelineStage, StageOutcome } from '../engine/types';
import { articleApprovalGate, assemblyStage, baseVariables, bodyMarkdown, defaultFinalize, seoCheckStage, setBodyFromMarkdown, tail } from './common';
import { externalLinksStage } from './stages/external-links';
import { celebrityImagesStage } from './stages/images';
import { humanizeStage } from './stages/humanize';
import { rankMathStage, wordpressDraftStage } from './stages/wordpress';

type ArticleData = { metaDescription?: string | null; slug?: string | null; seoTitle?: string | null };

const article: PipelineStage = {
  key: 'ARTICLE',
  label: 'Article',
  kind: 'chatgpt',
  status: 'WRITING_ARTICLE',
  progress: 35,
  async run(ctx): Promise<StageOutcome> {
    const a = await ctx.askChatGPT('ARTICLE', 'article', {}, { label: 'Article (Writer 2.0)' });
    const parsed = parseWriter2(a.markdown);
    const body = await setBodyFromMarkdown(ctx, parsed.body);
    const words = countWords(body.markdown);
    if (words < 300) throw new Error(`The article has only ${words} words (labels found: ${parsed.labelsFound.join(', ') || 'none'}).`);
    const title = parsed.title || titleCaseKeyword(ctx.task.keyword);
    const tags = parsed.tags.length ? parsed.tags : suggestTags(ctx.task.keyword, { quickBio: parsed.quickBio, secondary: stringArray(ctx.task.secondaryKeywords) });
    await ctx.update({
      selectedTitle: title,
      recommendedTitle: title,
      titleOptions: JSON.stringify([title]),
      quickBio: JSON.stringify(parsed.quickBio),
      faqs: JSON.stringify(parsed.faqs.slice(0, 10)),
      tags: JSON.stringify(tags),
      slug: parsed.slug ? slugify(parsed.slug) : slugify(ctx.task.keyword),
    });
    if (parsed.researchNotes) await writeLog({ taskId: ctx.task.id, category: 'CHATGPT', stage: 'ARTICLE', message: 'Research notes from ChatGPT (kept in the log, never published).', data: { notes: parsed.researchNotes.slice(0, 8000) } });
    if (parsed.anchors.length) await writeLog({ taskId: ctx.task.id, category: 'SEO', stage: 'ARTICLE', message: `Suggested internal-link anchors: ${parsed.anchors.join(', ')}` });
    const reasons: string[] = [];
    if (!parsed.quickBio.length) reasons.push('Writer 2.0: the answer had no readable Quick Bio table.');
    if (!parsed.faqs.length) reasons.push('Writer 2.0: the answer had no readable FAQs.');
    const data: ArticleData = { metaDescription: parsed.metaDescription, slug: parsed.slug };
    return {
      outcome: 'completed',
      prompt: a.prompt,
      output: body.markdown,
      outputHtml: body.html,
      data: { ...data, labels: parsed.labelsFound },
      reviewReasons: reasons,
      message: `${words} words, ${parsed.quickBio.length} Quick Bio rows, ${parsed.faqs.length} FAQs`,
    };
  },
};

export function writer2RegenerationPlan(stageKey: string, task: Pick<ArticleTask, 'wpPostId'>): string[] {
  switch (stageKey) {
    case 'ARTICLE':
      return ['ARTICLE', 'EXTERNAL_LINKS', 'HUMANIZE', ...tail(task)];
    case 'IMAGES':
      return ['IMAGES', ...tail(task)];
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
  return `We are writing a biography article about "${ctx.task.keyword}". The earlier chat is no longer available; this is the article so far:\n\n${body.slice(0, 12000)}\n\nUse it for the next task.`;
}

export const celebrity2Pipeline: PipelineDefinition = {
  moduleKey: 'celebrity-writer-2',
  kind: 'celebrity',
  stages: [
    article,
    externalLinksStage(50),
    celebrityImagesStage(62),
    humanizeStage(74),
    assemblyStage({ givenSeo: async (ctx) => (await ctx.stageData<ArticleData>('ARTICLE')) ?? {} }),
    seoCheckStage(),
    articleApprovalGate(),
    wordpressDraftStage(),
    rankMathStage(),
  ],
  maxWords: () => 2000,
  regenerationPlan: writer2RegenerationPlan,
  variables: (ctx, extra) => baseVariables(ctx, extra),
  contextPrimer: primer,
  finalize: defaultFinalize,
};
