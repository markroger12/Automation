import { prisma } from '@/server/db';
import { ConfigError } from '@/server/errors';
import { writeLog } from '@/server/log';
import { stringArray } from '@/lib/json';
import { assembleTaskContent, type ImagesData } from '@/server/reassemble';
import { internalLinkHtml } from '@/core/assembly';
import { buildSeoFields } from '@/core/seo-fields';
import { countKeyword, countWords, keywordDensity, slugify, titleCaseKeyword } from '@/core/text';
import { htmlToText, countTag } from '@/core/html';
import { L } from '@/core/language';
import { withProfilePage } from '../../browser/profiles';
import { installPublishGuard, openAdmin } from '../../wordpress/session';
import { detectEditor, renderPostContent, saveDraft, setRankMathMeta, type EditorKind, type MediaMap } from '../../wordpress/draft';
import { planFixes, readRankMath, focusKeywordMatches, type RankMathReading } from '../../wordpress/rankmath';
import { wpRestOk } from '../../wordpress/rest';
import { captureScreenshot } from '../../screenshots';
import type { PipelineContext, PipelineStage, StageOutcome } from '../../engine/types';
import { bodyMarkdown, setBodyFromMarkdown } from '../common';

type DraftData = { media?: MediaMap; editor?: EditorKind; postUrl?: string | null };

function requireWebsite(ctx: PipelineContext) {
  const w = ctx.task.website;
  if (!w) return null;
  if (!w.profileId) throw new ConfigError(`${w.name} has no browser profile. Open Websites, save the website and log in.`);
  return w;
}

export function wordpressDraftStage(): PipelineStage {
  return {
    key: 'WORDPRESS_DRAFT',
    label: 'WordPress draft',
    kind: 'wordpress',
    status: 'CREATING_DRAFT',
    progress: 94,
    async run(ctx): Promise<StageOutcome> {
      const website = requireWebsite(ctx);
      if (!website) return { outcome: 'completed', skipped: true, message: 'No website selected' };
      const t = ctx.task;
      if (!t.contentHtml) throw new Error('The article is not assembled yet.');
      const images = await ctx.stageData<ImagesData>('IMAGES');
      const prev = (await ctx.stageData<DraftData>('WORDPRESS_DRAFT')) ?? {};
      const assembly = await ctx.stageData<{ internalLink?: { url: string; title: string } | null }>('ASSEMBLY');
      const linkText = website.internalLinkText || L[ctx.language].internalLinkText;
      await ctx.update({ status: 'OPENING_WORDPRESS', statusMessage: `Opening ${website.name}…` });

      return withProfilePage(website.profileId!, async (page, context) => {
        await installPublishGuard(context, t.id);
        try {
          await openAdmin(page, website, 'edit.php', t.id);
          await ctx.update({ status: 'CREATING_DRAFT', statusMessage: 'Saving the WordPress draft…' });
          const editor = prev.editor ?? (await detectEditor(page, website));
          const result = await saveDraft(
            page,
            {
              website,
              taskId: t.id,
              postId: t.wpPostId,
              title: t.selectedTitle ?? t.keyword,
              contentHtml: t.contentHtml!,
              slug: t.slug,
              categoryId: t.categoryId,
              categoryName: t.categoryName,
              tags: stringArray(t.tags),
              images,
              media: prev.media ?? {},
              seo: { seoTitle: t.seoTitle, metaDescription: t.metaDescription, focusKeyword: t.focusKeyword || t.keyword },
              createMissingCategory: ctx.settings.createMissingCategory,
              internalLinkHtml: assembly?.internalLink ? internalLinkHtml({ text: linkText, ...assembly.internalLink }) : null,
              internalLinkText: linkText,
              onPostCreated: async (postId, editUrl) => {
                await ctx.update({ wpPostId: postId, wpEditUrl: editUrl, wpDraftSavedAt: new Date() });
              },
              onMediaUploaded: async (media) => {
                await ctx.saveProgress({ media, editor });
              },
              log: async (level, message) => {
                await writeLog({ taskId: t.id, level: level === 'warn' ? 'WARN' : 'INFO', category: 'WORDPRESS', stage: 'WORDPRESS_DRAFT', message });
              },
            },
            editor,
          );
          await ctx.update({ wpPostId: result.postId, wpEditUrl: result.editUrl, wpPostUrl: result.postUrl, wpDraftSavedAt: new Date(), categoryName: result.category ?? t.categoryName });
          await writeLog({ taskId: t.id, category: 'WORDPRESS', stage: 'WORDPRESS_DRAFT', message: `Draft ${result.postId} saved (${result.editor === 'GUTENBERG' ? 'block editor' : 'classic editor'}, category ${result.category ?? 'default'}, ${Object.keys(result.media).length} image(s)).`, data: { editUrl: result.editUrl } });
          return {
            outcome: 'completed',
            data: { media: result.media, editor: result.editor, postUrl: result.postUrl, liveUpdate: result.liveUpdate },
            reviewReasons: result.reviewReasons,
            message: result.liveUpdate ? 'Post already scheduled/live: internal link refreshed' : `Draft ${result.postId} saved`,
          };
        } catch (err) {
          const shot = await captureScreenshot(page, 'wordpress-error', t.id);
          if (shot && err instanceof Error) Object.assign(err, { screenshotPath: shot });
          throw err;
        }
      });
    },
  };
}

/** Rejects revisions that change the article too much. */
export function revisionProblem(before: string, after: string, keyword: string): string | null {
  const wb = countWords(htmlToText(before));
  const wa = countWords(htmlToText(after));
  if (wa > wb * 1.15) return `it adds ${Math.round((wa / wb - 1) * 100)}% words`;
  if (wa < wb * 0.7) return `it cuts ${Math.round((1 - wa / wb) * 100)}% of the words`;
  if (countTag(after, 'h2') < countTag(before, 'h2')) return 'it loses H2 headings';
  if (keywordDensity(htmlToText(after), keyword) > 2.5) return 'keyword density goes above 2.5%';
  return null;
}

export function rankMathStage(): PipelineStage {
  return {
    key: 'RANKMATH',
    label: 'Rank Math',
    kind: 'wordpress',
    status: 'RUNNING_RANKMATH',
    progress: 100,
    async run(ctx): Promise<StageOutcome> {
      const website = requireWebsite(ctx);
      const t = ctx.task;
      if (!website || !t.wpPostId) return { outcome: 'completed', skipped: true, message: 'No WordPress draft' };
      const draft = (await ctx.stageData<DraftData & { liveUpdate?: boolean }>('WORDPRESS_DRAFT')) ?? {};
      if (draft.liveUpdate) return { outcome: 'completed', skipped: true, message: 'The post is already scheduled or live' };
      const target = ctx.settings.rankMathTargetScore;
      const keyword = t.focusKeyword || t.keyword;
      const K = titleCaseKeyword(keyword);
      const reasons: string[] = [];
      let revised = false;

      return withProfilePage(website.profileId!, async (page, context) => {
        await installPublishGuard(context, t.id);
        try {
          let reading: RankMathReading = await readRankMath(page, website, t.wpPostId!);
          if (reading.score === null) {
            return { outcome: 'completed', skipped: true, reviewReasons: ['Rank Math score not found in the editor (is Rank Math active?).'], message: 'Rank Math panel not found' };
          }
          await writeLog({ taskId: t.id, category: 'RANKMATH', stage: 'RANKMATH', message: `Rank Math score ${reading.score} (target ${target}).`, data: { failed: reading.tests.filter((x) => x.status !== 'ok').map((x) => x.text) } });
          if (reading.focusKeyword && !focusKeywordMatches(reading.focusKeyword, keyword)) {
            await setRankMathMeta(page, website.adminUrl, t.wpPostId!, { rank_math_focus_keyword: keyword });
            reasons.push(`Rank Math showed the focus keyword "${reading.focusKeyword}" instead of "${keyword}"; it was set again.`);
          }

          for (let round = 1; round <= ctx.settings.maxRankMathAttempts && (reading.score ?? 0) < target; round++) {
            const plan = planFixes(reading.tests);
            const changes: string[] = [];
            await ctx.refresh();
            const cur = ctx.task;
            if (plan.seoTitle || plan.meta) {
              const fields = buildSeoFields({ title: cur.selectedTitle ?? keyword, keyword, kind: ctx.kind, language: ctx.language, introText: '', given: { seoTitle: plan.seoTitle ? null : cur.seoTitle, metaDescription: plan.meta ? null : cur.metaDescription, slug: cur.slug } });
              let seoTitle = fields.seoTitle;
              if (plan.seoTitle && !seoTitle.toLowerCase().startsWith(keyword.toLowerCase())) seoTitle = `${K}: ${seoTitle.replace(new RegExp(`^${K}[:\\s-–]*`, 'i'), '')}`.slice(0, 60);
              let meta = fields.metaDescription;
              if (plan.meta && !meta.toLowerCase().startsWith(keyword.toLowerCase())) meta = `${K} – ${meta}`.slice(0, 158);
              await setRankMathMeta(page, website.adminUrl, t.wpPostId!, { rank_math_title: seoTitle, rank_math_description: meta });
              await ctx.update({ seoTitle, metaDescription: meta });
              changes.push(plan.seoTitle ? 'SEO title' : '', plan.meta ? 'meta description' : '');
            }
            if (plan.slug) {
              const slug = slugify(keyword);
              await wpRestOk(page, website.adminUrl, { method: 'POST', path: `/wp/v2/posts/${t.wpPostId}`, body: { slug, status: 'draft' } });
              await ctx.update({ slug });
              changes.push('slug');
            }
            if (plan.content && !revised) {
              revised = true;
              const issues = reading.tests.filter((x) => x.status !== 'ok').map((x) => `- ${x.text}`).join('\n');
              const before = cur.bodyHtml ?? '';
              const answer = await ctx.askChatGPT('RANKMATH', 'seo_correction', { rankmath_issues: issues, final_article: bodyMarkdown(ctx) }, { label: 'SEO correction' });
              const { markdown } = { markdown: answer.markdown };
              const problem = revisionProblem(before, answer.html, keyword);
              if (problem) {
                await writeLog({ taskId: t.id, level: 'WARN', category: 'RANKMATH', stage: 'RANKMATH', message: `Content revision rejected: ${problem}.` });
              } else {
                await setBodyFromMarkdown(ctx, markdown);
                const images = await ctx.stageData<ImagesData>('IMAGES');
                const assembly = await ctx.stageData<{ internalLink?: { url: string; title: string } | null }>('ASSEMBLY');
                const contentHtml = assembleTaskContent(ctx.task, images, assembly?.internalLink ?? null);
                await ctx.update({ contentHtml });
                const content = renderPostContent(contentHtml, images, draft.media ?? {}, draft.editor ?? 'GUTENBERG');
                await wpRestOk(page, website.adminUrl, { method: 'POST', path: `/wp/v2/posts/${t.wpPostId}`, body: { content, status: 'draft' } });
                changes.push(`content (keyword uses ${countKeyword(htmlToText(contentHtml), keyword)})`);
              }
            }
            const applied = changes.filter(Boolean);
            if (!applied.length) break;
            await writeLog({ taskId: t.id, category: 'RANKMATH', stage: 'RANKMATH', message: `Round ${round}: fixed ${applied.join(', ')}.` });
            reading = await readRankMath(page, website, t.wpPostId!);
            await writeLog({ taskId: t.id, category: 'RANKMATH', stage: 'RANKMATH', message: `Rank Math score after round ${round}: ${reading.score}.` });
          }

          const score = reading.score ?? 0;
          // Store the score Rank Math showed, as its editor would on save.
          await setRankMathMeta(page, website.adminUrl, t.wpPostId!, { rank_math_seo_score: score });
          const checks = reading.tests.map((x, i) => ({ id: `rm-${i}`, label: x.text, passed: x.status === 'ok', detail: x.status }));
          await prisma.sEOReport.create({ data: { taskId: t.id, source: 'RANKMATH', score, checks: JSON.stringify(checks) } });
          await ctx.update({ rankMathScore: score });
          if (score < target) {
            const unfixable = planFixes(reading.tests).unfixable;
            reasons.push(`Rank Math score ${score} is below ${target}.`);
            for (const u of unfixable.slice(0, 6)) reasons.push(`Rank Math: ${u}`);
          }
          return { outcome: 'completed', data: { score, tests: reading.tests }, reviewReasons: reasons, message: `Rank Math score ${score}` };
        } catch (err) {
          const shot = await captureScreenshot(page, 'rankmath-error', t.id);
          if (shot && err instanceof Error) Object.assign(err, { screenshotPath: shot });
          throw err;
        }
      });
    },
  };
}
