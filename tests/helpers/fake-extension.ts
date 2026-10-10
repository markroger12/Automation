/**
 * A scripted stand-in for the browser extension: claims ChatGPT jobs through the real agent handler and
 * answers them with canned text chosen by the prompt.
 */
export type Answerer = (prompt: string, job: { allowReuse: boolean; newChat: boolean; conversationUrl: string | null; expect: string }) =>
  | { text: string; html?: string; images?: { base64: string; width: number; height: number }[]; imageLinks?: { url: string; width: number; height: number }[] }
  | { fail: 'LOGIN' | 'CONVERSATION_LOST' | 'USAGE_LIMIT' | 'ERROR'; message: string };

export function startFakeExtension(answer: Answerer, opts: { tabId?: number; delayMs?: number } = {}) {
  let running = true;
  const seen: { prompt: string; allowReuse: boolean; newChat: boolean; conversationUrl: string | null }[] = [];
  const tabId = opts.tabId ?? 1;
  let conv = 0;
  const loop = (async () => {
    const { handleAgent, agentSchema } = await import('@/server/extension-agent');
    while (running) {
      const claim = (await handleAgent(agentSchema.parse({ action: 'claim', tabId, features: ['text', 'long-prompt', 'images', 'gallery', 'attachments'], version: 'test' }))) as {
        job: null | { id: string; prompt: string; allowReuse: boolean; newChat: boolean; conversationUrl: string | null; expect: string };
      };
      if (!claim.job) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const job = claim.job;
      seen.push({ prompt: job.prompt, allowReuse: job.allowReuse, newChat: job.newChat, conversationUrl: job.conversationUrl });
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 50));
      const out = answer(job.prompt, job);
      if ('fail' in out) {
        await handleAgent(agentSchema.parse({ action: 'fail', tabId, jobId: job.id, code: out.fail, message: out.message, debug: { step: 'failed', test: true } }));
      } else {
        const url = job.newChat || !job.conversationUrl ? `https://chatgpt.com/c/00000000-0000-0000-0000-${String(++conv).padStart(12, '0')}` : job.conversationUrl;
        await handleAgent(
          agentSchema.parse({ action: 'complete', tabId, jobId: job.id, text: out.text, html: out.html ?? '', conversationUrl: url, reusedExisting: false, images: out.images ?? [], imageLinks: out.imageLinks ?? [] }),
        );
      }
    }
  })();
  return {
    seen,
    stop: async () => {
      running = false;
      await loop;
    },
  };
}

export const SAMPLE = {
  titles: '1. Sydney Sweeney: Age, Career and Net Worth\n2. Who Is Sydney Sweeney?\n\nRecommended Title: Sydney Sweeney: Age, Career and Net Worth',
  research: 'Sydney Sweeney was born on 12 September 1997 in Spokane, Washington. '.repeat(15),
  longArticle: ('## Early Life\n\n' + 'Sydney Sweeney grew up in Spokane and loved acting from a young age. '.repeat(25) + '\n\n## Career\n\n' + 'Her breakthrough came with Euphoria and The White Lotus. '.repeat(25)).trim(),
  finalArticle: [
    "Here is the final article:",
    '',
    'Sydney Sweeney is an American actress known for Euphoria. ' + 'She has become one of the most talked-about actresses of her generation. '.repeat(3),
    '',
    '## Sydney Sweeney Early Life',
    '',
    'Sydney Sweeney was born in Spokane, Washington, and grew up in a close family. '.repeat(6),
    '',
    '## Career',
    '',
    'Her career took off when Sydney Sweeney joined the cast of Euphoria in 2019. '.repeat(6),
    '',
    '### Film Roles',
    '',
    'She later starred in several films that showed her range. '.repeat(5),
    '',
    '## Personal Life',
    '',
    'Sydney Sweeney keeps much of her private life away from the spotlight. '.repeat(5),
    '',
    '## Conclusion',
    '',
    'Sydney Sweeney continues to grow as an actress and producer. '.repeat(3),
    '',
    'I hope this helps!',
  ].join('\n'),
  faqs: 'How old is Sydney Sweeney?\nShe was born in 1997.\n\nWhere is Sydney Sweeney from?\nSpokane, Washington.\n\nIs Sydney Sweeney married?\nShe is not married.',
  quickBio: '| Attribute | Details |\n|---|---|\n| Full Name | Sydney Bernice Sweeney |\n| Profession | Actress, producer |\n| Date of Birth | 12 September 1997 |\n| Birthplace | Spokane, Washington |',
};

export function celebrityAnswer(prompt: string): string {
  if (/Generate some best titles/i.test(prompt)) return SAMPLE.titles;
  if (/Collect all available reliable information/i.test(prompt)) return SAMPLE.research;
  if (/1,500 to 2,000-word/i.test(prompt)) return SAMPLE.longArticle;
  if (/rewrite and optimize the previous article/i.test(prompt)) return SAMPLE.finalArticle;
  if (/frequently asked questions/i.test(prompt)) return SAMPLE.faqs;
  if (/Quick Bio table/i.test(prompt)) return SAMPLE.quickBio;
  return 'OK';
}
