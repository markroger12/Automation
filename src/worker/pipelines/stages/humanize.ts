import { getPromptContent } from '@/server/prompts';
import { writeLog } from '@/server/log';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { L, languageLine } from '@/core/language';
import type { PipelineStage, StageOutcome } from '../../engine/types';
import { humanizeHtml } from '../../humanizer/run';

type HumanizeData = { original?: string; output?: string; parts?: Record<string, Record<string, string>> };

/** Mandatory editorial rewrite in the article's own ChatGPT chat, with fact locks. */
export function humanizeStage(progress = 76): PipelineStage {
  return {
    key: 'HUMANIZE',
    label: 'Humanize',
    kind: 'chatgpt',
    status: 'OPTIMIZING',
    progress,
    async run(ctx): Promise<StageOutcome> {
      const body = ctx.task.bodyHtml;
      if (!body) throw new Error('There is no article body to humanize.');
      const prev = (await ctx.stageData<HumanizeData>('HUMANIZE')) ?? {};
      // A regeneration on an unchanged body starts again from the original.
      const original = prev.original && prev.output === body ? prev.original : body;
      const resumeParts = (ctx.mode === 'run' || ctx.attempt > 1) && prev.original === original && !prev.output ? (prev.parts ?? {}) : {};
      const parts: Record<string, Record<string, string>> = { ...resumeParts };
      await ctx.saveProgress({ original, parts, output: null });
      const template = await getPromptContent(ctx.pipeline.moduleKey, 'humanizer');
      const country = ctx.task.targetCountry || ctx.settings.targetCountry;

      const { html, report } = await humanizeHtml({
        html: original,
        keyword: ctx.task.keyword,
        language: ctx.language,
        promptTemplate: template,
        mode: 'every',
        linkText: ctx.task.website?.internalLinkText || L[ctx.language].internalLinkText,
        resume: resumeParts,
        send: async (prompt, i, n) => {
          const a = await ctx.sendPrompt('HUMANIZE', `${prompt}\n\n${languageLine(ctx.language, country)}`, { label: `Humanize ${i + 1}/${n}` });
          return a.markdown;
        },
        onPart: async (i, accepted) => {
          parts[String(i)] = accepted;
          await ctx.saveProgress({ parts });
        },
        log: async (level, message, data) => {
          await writeLog({ taskId: ctx.task.id, level: level === 'warn' ? 'WARN' : 'INFO', category: 'SEO', stage: 'HUMANIZE', message, data });
        },
      });
      const output = sanitizeArticleHtml(html);
      await ctx.update({ bodyHtml: output });
      for (const r of report.paragraphs.filter((x) => x.status === 'kept' && x.reason)) {
        await writeLog({ taskId: ctx.task.id, level: 'DEBUG', category: 'SEO', stage: 'HUMANIZE', message: `[P${r.n}] kept: ${r.reason}`, data: { before: r.before.slice(0, 400), after: r.after.slice(0, 400) } });
      }
      const summary = `Humanizer: ${report.rewritten} paragraph(s) rewritten, ${report.kept} kept; AI-signal density ${report.densityBefore} → ${report.densityAfter} per 100 words; sentence rhythm ${report.rhythmBefore} → ${report.rhythmAfter}${report.failedParts ? `; ${report.failedParts} part(s) failed` : ''}.`;
      await writeLog({ taskId: ctx.task.id, category: 'SEO', stage: 'HUMANIZE', message: summary, data: { notes: report.notes } });
      return {
        outcome: 'completed',
        data: { original, output, parts, report: { ...report, paragraphs: report.paragraphs.map((p) => ({ n: p.n, status: p.status, reason: p.reason, warnings: p.warnings })) } },
        message: summary,
      };
    },
  };
}
