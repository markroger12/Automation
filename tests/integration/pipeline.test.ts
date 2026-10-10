import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb } from '../helpers/test-db';
import { celebrityAnswer, startFakeExtension } from '../helpers/fake-extension';

setupTestDb();

const { prisma } = await import('@/server/db');
const { createArticleTask } = await import('@/server/tasks');
const { seedPrompts } = await import('@/server/prompts');
const { saveSettings } = await import('@/server/settings');
const { claimNext } = await import('@/server/queue');
const { runArticleJob } = await import('@/worker/engine/run-job');

async function runQueued(taskId: string) {
  const job = await claimNext('article', 'test-worker', { where: { taskId } });
  expect(job).not.toBeNull();
  await runArticleJob(job!, new AbortController().signal);
  await prisma.queueJob.update({ where: { id: job!.id }, data: { status: 'COMPLETED' } });
  return prisma.articleTask.findUniqueOrThrow({ where: { id: taskId }, include: { stages: { orderBy: { position: 'asc' } } } });
}

describe('pipeline engine with Celebrity Writer 1.0', () => {
  beforeAll(async () => {
    await seedPrompts();
    await saveSettings({ retryAttempts: 1, minKeywordOccurrences: 5, maxKeywordOccurrences: 20, articleImages: false });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes the article through every stage in one conversation', async () => {
    const ext = startFakeExtension((p) => ({ text: celebrityAnswer(p) }));
    const task = await createArticleTask({ moduleKey: 'celebrity-writer', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English' });
    const done = await runQueued(task.id);
    await ext.stop();

    expect(done.status).toBe('NEEDS_REVIEW'); // no website: not sent to WordPress
    expect(JSON.parse(done.reviewReasons)).toContain('No website selected: the article was not sent to WordPress.');
    expect(done.selectedTitle).toBe('Sydney Sweeney: Age, Career and Net Worth');
    expect(done.contentHtml).toContain('<h2>Quick Bio of Sydney Bernice Sweeney</h2>');
    expect(done.contentHtml).toContain('<h2>Frequently Asked Questions</h2>');
    expect(done.contentHtml).not.toContain('Here is the final article');
    expect(done.contentHtml).not.toContain('I hope this helps');
    expect(done.seoTitle).toBeTruthy();
    expect(done.slug).toBe('sydney-sweeney');
    expect(JSON.parse(done.tags)).toContain('Sydney Sweeney');
    expect(done.seoScore).toBeGreaterThan(50);
    expect(done.progress).toBe(100);
    // one conversation: only the first prompt starts a new chat
    expect(ext.seen[0]!.newChat).toBe(true);
    expect(ext.seen.slice(1).every((s) => !s.newChat && s.conversationUrl === done.chatgptConversationUrl)).toBe(true);
    // the language line is appended to every text prompt
    expect(ext.seen.every((s) => s.prompt.trim().endsWith('Write in English for readers in United States.'))).toBe(true);
    // run mode allows recovering an answer that is already in the chat
    expect(ext.seen.every((s) => s.allowReuse)).toBe(true);
    const order = done.stages.map((s) => `${s.key}:${s.status}`);
    expect(order).toContain('FINAL_ARTICLE:COMPLETED');
    expect(order).toContain('WORDPRESS_DRAFT:SKIPPED');
    // titles, research, long, final, FAQs, Quick Bio, external links, humanizer
    const asked = await prisma.chatGPTResponse.findMany({ where: { taskId: task.id }, orderBy: { createdAt: 'asc' } });
    expect(asked.map((r) => r.stageKey)).toEqual(['TITLES', 'RESEARCH', 'LONG_ARTICLE', 'FINAL_ARTICLE', 'FAQS', 'QUICK_BIO', 'EXTERNAL_LINKS', 'HUMANIZE']);
  }, 120_000);

  it('pauses for title approval and continues without asking again', async () => {
    await saveSettings({ manualTitleApproval: true });
    const ext = startFakeExtension((p) => ({ text: celebrityAnswer(p) }));
    const task = await createArticleTask({ moduleKey: 'celebrity-writer', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English' });
    let t = await runQueued(task.id);
    expect(t.status).toBe('AWAITING_TITLE_APPROVAL');
    expect(ext.seen).toHaveLength(1);
    await prisma.articleTask.update({ where: { id: task.id }, data: { selectedTitle: 'Who Is Sydney Sweeney?', titleApprovedAt: new Date() } });
    const { enqueueArticleRun } = await import('@/server/tasks');
    await enqueueArticleRun(task.id);
    t = await runQueued(task.id);
    await ext.stop();
    await saveSettings({ manualTitleApproval: false });
    expect(t.status).toBe('NEEDS_REVIEW');
    expect(ext.seen.filter((s) => /best titles/.test(s.prompt))).toHaveLength(1);
    expect(t.selectedTitle).toBe('Who Is Sydney Sweeney?');
  }, 120_000);

  it('waits for a ChatGPT login instead of failing, then resumes from the same stage', async () => {
    let failRemaining = 1;
    const ext = startFakeExtension((p) => {
      if (/Collect all available/.test(p) && failRemaining-- > 0) return { fail: 'LOGIN', message: 'logged out' };
      return { text: celebrityAnswer(p) };
    });
    const task = await createArticleTask({ moduleKey: 'celebrity-writer', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English' });
    let t = await runQueued(task.id);
    expect(t.status).toBe('LOGIN_REQUIRED');
    expect(t.loginRequiredFor).toBe('chatgpt');
    expect(t.stages.find((s) => s.key === 'RESEARCH')!.status).toBe('PENDING');
    expect(t.stages.find((s) => s.key === 'TITLES')!.status).toBe('COMPLETED');
    const { enqueueArticleRun } = await import('@/server/tasks');
    await enqueueArticleRun(task.id);
    t = await runQueued(task.id);
    await ext.stop();
    expect(t.status).toBe('NEEDS_REVIEW');
    expect(ext.seen.filter((s) => /best titles/.test(s.prompt))).toHaveLength(1);
  }, 120_000);

  it('retries a failed stage with backoff and logs the extension debug snapshot', async () => {
    let failRemaining = 1;
    const ext = startFakeExtension((p) => {
      if (/frequently asked questions/i.test(p) && failRemaining-- > 0) return { fail: 'ERROR', message: 'The prompt did not appear in the chat within 180 s.' };
      return { text: celebrityAnswer(p) };
    });
    const task = await createArticleTask({ moduleKey: 'celebrity-writer', keyword: 'Sydney Sweeney', targetCountry: 'United States', language: 'English' });
    const t = await runQueued(task.id);
    await ext.stop();
    expect(t.status).toBe('NEEDS_REVIEW');
    const faqStage = t.stages.find((s) => s.key === 'FAQS')!;
    expect(faqStage.attempts).toBe(2);
    const err = await prisma.log.findFirst({ where: { taskId: task.id, level: 'ERROR', stage: 'FAQS' } });
    expect(err!.message).toContain('did not appear');
    expect(err!.data).toContain('extensionDebug');
    // second attempt of a stage may recover an answer that is already in the chat
    const faqPrompts = ext.seen.filter((s) => /frequently asked questions/i.test(s.prompt));
    expect(faqPrompts[1]!.allowReuse).toBe(true);
  }, 120_000);
});
