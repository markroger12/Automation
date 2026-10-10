import { htmlToMarkdown } from '@/core/markdown';
import { parseLinkSuggestions, placeLinks, type PlacedLink } from '@/core/external-links';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { writeLog } from '@/server/log';
import type { PipelineStage, StageOutcome } from '../../engine/types';
import { verifyLink, defaultFetcher, type Fetcher, type Verified } from '../../links/verify';

let fetcher: Fetcher = defaultFetcher;
/** Tests replace the network. */
export function setLinkFetcher(f: Fetcher) {
  fetcher = f;
}

type LinksData = { input?: string; output?: string };

export function externalLinksStage(progress = 60): PipelineStage {
  return {
    key: 'EXTERNAL_LINKS',
    label: 'External links',
    kind: 'chatgpt',
    status: 'OPTIMIZING',
    progress,
    async run(ctx): Promise<StageOutcome> {
      const s = ctx.settings;
      if (!s.externalLinks || s.maxExternalLinks <= 0) return { outcome: 'completed', skipped: true, message: 'External links are switched off' };
      const body = ctx.task.bodyHtml;
      if (!body) throw new Error('There is no article body to link.');
      // A regeneration on an unchanged body starts again from the body before the links.
      const prev = await ctx.stageData<LinksData>('EXTERNAL_LINKS');
      const input = prev?.input && prev.output === body ? prev.input : body;

      const a = await ctx.askChatGPT('EXTERNAL_LINKS', 'external_links', { final_article: htmlToMarkdown(input) }, { label: 'External links' });
      const suggestions = parseLinkSuggestions(a.markdown);
      const verified: Verified[] = [];
      for (const sug of suggestions.slice(0, 12)) verified.push(await verifyLink(sug, ctx.language, fetcher));
      const ok = verified.filter((v): v is Extract<Verified, { ok: true }> => v.ok).map<PlacedLink>((v) => ({ phrase: v.phrase, url: v.url, kind: v.kind }));
      const placed = placeLinks(input, ok, { max: s.maxExternalLinks, keyword: ctx.task.keyword });
      const output = sanitizeArticleHtml(placed.html);
      await ctx.update({ bodyHtml: output });

      for (const v of verified) {
        if (!v.ok) await writeLog({ taskId: ctx.task.id, level: 'INFO', category: 'SEO', stage: 'EXTERNAL_LINKS', message: `Link refused: "${v.phrase}" → ${v.url}: ${v.reason}` });
      }
      for (const r of placed.refused) await writeLog({ taskId: ctx.task.id, level: 'INFO', category: 'SEO', stage: 'EXTERNAL_LINKS', message: `Link not placed: "${r.phrase}" → ${r.url}: ${r.reason}` });
      for (const l of placed.added) await writeLog({ taskId: ctx.task.id, category: 'SEO', stage: 'EXTERNAL_LINKS', message: `Link added: "${l.phrase}" → ${l.url} (${l.kind})` });

      return {
        outcome: 'completed',
        prompt: a.prompt,
        output: a.markdown,
        data: { input, output, added: placed.added, refused: [...verified.filter((v) => !v.ok), ...placed.refused] },
        message: `${placed.added.length} external link(s) added, ${suggestions.length - placed.added.length} refused`,
      };
    },
  };
}
