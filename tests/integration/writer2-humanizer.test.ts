import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb } from '../helpers/test-db';
import { startFakeExtension } from '../helpers/fake-extension';

setupTestDb();
const { prisma } = await import('@/server/db');
const { createArticleTask } = await import('@/server/tasks');
const { seedPrompts } = await import('@/server/prompts');
const { saveSettings } = await import('@/server/settings');
const { claimNext } = await import('@/server/queue');
const { runArticleJob } = await import('@/worker/engine/run-job');

const para = (s: string) => `${s} ${'Sydney Sweeney keeps working on new film and television projects with care. '.repeat(6)}`;

const WRITER2 = `Sure! I researched the topic carefully.

**1. H1 / Article Title:**
Sydney Sweeney: Age, Career and Life

**2. Introduction:**
${para('Furthermore, Sydney Sweeney is a pivotal American actress born in 1997.')}

**3. Quick Bio table:**
| Attribute | Details |
|---|---|
| Full Name | Sydney Bernice Sweeney |
| Profession | Actress |

**4. Main article:**
## Early Life
${para('She grew up in Spokane with 1 brother.')}

## Career
${para('Her role in Euphoria started in 2019.')}

${para('She later joined The White Lotus in 2021.')}

**5. Five FAQs:**
### How old is Sydney Sweeney?
She was born in 1997.

**6. Final Thoughts:**
${para('Sydney Sweeney is still growing as an actress.')}

**7. Meta Description:** Sydney Sweeney's age, career and life in one place, with every fact about Sydney Sweeney checked.
**8. Suggested URL Slug:** sydney-sweeney-age-career
**9. Tags:** Sydney Sweeney, Euphoria, Actress
**10. Research Notes:** Wikipedia. Height unconfirmed.`;

async function runQueued(taskId: string) {
  const job = await claimNext('article', 'test', { where: { taskId } });
  await runArticleJob(job!, new AbortController().signal);
  await prisma.queueJob.update({ where: { id: job!.id }, data: { status: 'COMPLETED' } });
  return prisma.articleTask.findUniqueOrThrow({ where: { id: taskId }, include: { stages: { orderBy: { position: 'asc' } } } });
}

describe('Celebrity Writer 2.0 and the humanizer stage', () => {
  beforeAll(async () => {
    await seedPrompts();
    await saveSettings({ retryAttempts: 0, minKeywordOccurrences: 3, maxKeywordOccurrences: 40, externalLinks: false });
  });
  afterAll(async () => prisma.$disconnect());

  it('parses one answer into the article and humanizes it with fact locks', async () => {
    const ext = startFakeExtension((p) => {
      if (/^Primary Keyword: \[Sydney Sweeney\]/.test(p)) return { text: WRITER2 };
      if (/senior magazine editor/.test(p)) {
        // P1: good rewrite (drops "Furthermore", "pivotal"); P2: changes a number → must be kept
        const p1 = /\[P1\]\n([^\n]+)/.exec(p)![1]!.replace('Furthermore, Sydney Sweeney is a pivotal American actress', 'Sydney Sweeney is an important American actress');
        const p2 = /\[P2\]\n([^\n]+)/.exec(p)![1]!.replace('1 brother', '2 brothers');
        return { text: `[P1]\n${p1}\n\n[P2]\n${p2}` };
      }
      return { text: 'OK' };
    });
    const task = await createArticleTask({ moduleKey: 'celebrity-writer-2', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English' });
    const done = await runQueued(task.id);
    await ext.stop();

    expect(done.selectedTitle).toBe('Sydney Sweeney: Age, Career and Life');
    expect(done.slug).toBe('sydney-sweeney-age-career');
    expect(JSON.parse(done.tags)).toEqual(['Sydney Sweeney', 'Euphoria', 'Actress']);
    expect(done.metaDescription).toContain("Sydney Sweeney's age");
    expect(done.contentHtml).toContain('<h2>Quick Bio of Sydney Bernice Sweeney</h2>');
    expect(done.contentHtml).toContain('<h2>Final Thoughts</h2>');
    expect(done.contentHtml).not.toContain('Research Notes');
    expect(done.contentHtml).not.toContain('Height unconfirmed');
    expect(done.contentHtml).not.toContain('I researched');
    // humanizer: P1 rewritten, P2 kept (numbers changed)
    expect(done.bodyHtml).toContain('Sydney Sweeney is an important American actress');
    expect(done.bodyHtml).not.toContain('pivotal');
    expect(done.bodyHtml).toContain('1 brother');
    const h = JSON.parse(done.stages.find((s) => s.key === 'HUMANIZE')!.data!) as { original: string; output: string; report: { rewritten: number; paragraphs: { n: number; status: string; reason?: string }[] } };
    expect(h.report.paragraphs.find((p) => p.n === 2)).toMatchObject({ status: 'kept' });
    expect(h.report.paragraphs.find((p) => p.n === 2)!.reason).toMatch(/numbers/);
    expect(h.original).toContain('pivotal');
    const notes = await prisma.log.findFirst({ where: { taskId: task.id, message: { contains: 'Research notes' } } });
    expect(notes).not.toBeNull();
    const summary = await prisma.log.findFirst({ where: { taskId: task.id, message: { startsWith: 'Humanizer:' } } });
    expect(summary!.message).toMatch(/AI-signal density/);
  }, 120_000);
});
