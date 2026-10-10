import type { QueueJob } from '@prisma/client';
import { prisma } from '@/server/db';
import { jobData } from '@/server/queue';
import { getPromptContent } from '@/server/prompts';
import { writeLog } from '@/server/log';
import { asLang, languageLine } from '@/core/language';
import { normalizeAnswer } from '@/core/markdown';
import { askViaExtension } from '../chatgpt/client';
import { humanizeHtml } from './run';

type Data = { html: string; keyword: string; language: string; country?: string; mode: 'every' | 'flagged'; prompt?: string | null; taskId?: string | null };

/** "humanizer" queue: the AI Humanizer test page. Runs in its own new chat; nothing is saved to an article. */
export async function handleHumanizerJob(job: QueueJob): Promise<unknown> {
  const d = jobData<Data>(job, { html: '', keyword: '', language: 'English', mode: 'every' });
  const lang = asLang(d.language);
  const template = d.prompt?.trim() || (await getPromptContent('ai-humanizer', 'humanizer'));
  let conversationUrl: string | null = null;
  const { html, report } = await humanizeHtml({
    html: d.html,
    keyword: d.keyword,
    language: lang,
    promptTemplate: template,
    mode: d.mode,
    send: async (prompt, i, n) => {
      await prisma.queueJob.update({ where: { id: job.id }, data: { progress: JSON.stringify({ part: i + 1, of: n }), heartbeatAt: new Date() } });
      const r = await askViaExtension({
        taskId: null,
        stageKey: 'HUMANIZER_TEST',
        label: `Humanizer test ${i + 1}/${n}`,
        prompt: `${prompt}\n\n${languageLine(lang, d.country || (lang === 'German' ? 'Germany' : 'United States'))}`,
        conversationUrl,
        newChat: !conversationUrl,
        allowReuse: false,
        fresh: true,
      });
      conversationUrl = r.conversationUrl ?? conversationUrl;
      return normalizeAnswer(r);
    },
    log: async (level, message) => {
      await writeLog({ level: level === 'warn' ? 'WARN' : 'INFO', category: 'SEO', message: `Humanizer test: ${message}` });
    },
  });
  return { before: d.html, html, report, conversationUrl };
}
