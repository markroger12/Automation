import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserContext, Page, Worker } from 'playwright';
import { findExtensionBrowser, launchWithExtension, startAgentServer, sleep } from '../helpers/extension-harness';
import { FakeChatGPT, defaultAnswer } from '../helpers/fake-chatgpt';
import { setupTestDb } from '../helpers/test-db';
import type { ChatJobData, ChatJobResult } from '@/server/chatgpt-jobs';

const target = findExtensionBrowser();

type Prisma = typeof import('@/server/db')['prisma'];

describe.skipIf(!target)('ChatGPT Worker extension (fake chatgpt.com)', () => {
  let prisma: Prisma;
  let context: BrowserContext;
  let sw: Worker;
  let fake: FakeChatGPT;
  let server: Awaited<ReturnType<typeof startAgentServer>>;
  let key: string;

  async function enqueue(data: Partial<ChatJobData> & { prompt: string }): Promise<string> {
    const full: ChatJobData = { conversationUrl: null, newChat: true, allowReuse: false, expect: 'text', timeoutSec: 120, label: 'test', ...data };
    const job = await prisma.queueJob.create({ data: { queue: 'chatgpt', name: 'prompt', data: JSON.stringify(full) } });
    return job.id;
  }

  async function waitJob(id: string, timeoutMs = 60_000) {
    const start = Date.now();
    for (;;) {
      const job = await prisma.queueJob.findUniqueOrThrow({ where: { id } });
      if (job.status === 'COMPLETED' || job.status === 'FAILED') return job;
      if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} still ${job.status}: ${job.progress}`);
      await sleep(300);
    }
  }

  async function openChat(): Promise<Page> {
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/');
    return page;
  }

  async function closePages() {
    for (const p of context.pages()) await p.close().catch(() => undefined);
  }

  beforeAll(async () => {
    setupTestDb();
    ({ prisma } = await import('@/server/db'));
    const { handleAgent, agentSchema } = await import('@/server/extension-agent');
    const { verifyConnectionKey, createConnectionKey } = await import('@/server/extension-key');
    key = await createConnectionKey();
    server = await startAgentServer(async (body, auth) => {
      if (!(await verifyConnectionKey(auth ?? null))) return { status: 401, json: { error: 'bad key' } };
      return { status: 200, json: await handleAgent(agentSchema.parse(body)) };
    });
    ({ context, sw } = await launchWithExtension(target!));
    fake = new FakeChatGPT();
    await fake.install(context);
    await sw.evaluate(async (cfg) => chrome.storage.local.set(cfg), { appUrl: server.url, key, automationChrome: true, paused: true });
  }, 120_000);

  afterAll(async () => {
    await context?.close();
    await server?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await closePages();
    fake.reset();
    await prisma.queueJob.deleteMany({});
    await sw.evaluate(async () => chrome.storage.local.set({ readSlot: { nextAt: 0, level: 0 } }));
  });

  it('answers a prompt on the old page variant (markers)', async () => {
    fake.setMode({ mode: 'markers' });
    const id = await enqueue({ prompt: 'Generate some best titles for Sydney Sweeney.' });
    await openChat();
    const job = await waitJob(id);
    expect(job.error).toBeNull();
    const result = JSON.parse(job.result!) as ChatJobResult;
    expect(result.text).toContain('Answer to: Generate some best titles for Sydney Sweeney.');
    expect(result.html).toContain('<h2>Early Life</h2>');
    expect(result.conversationUrl).toMatch(/^https:\/\/chatgpt\.com\/c\/[0-9a-f-]{36}$/);
    expect(result.reusedExisting).toBe(false);
    expect(fake.received).toHaveLength(1);
  }, 90_000);

  it('reads the answer from the conversation when the page has no markers', async () => {
    fake.setMode({ mode: 'no-markers' });
    const id = await enqueue({ prompt: 'Write a research summary about Sydney Sweeney.' });
    await openChat();
    const job = await waitJob(id);
    expect(job.error).toBeNull();
    const result = JSON.parse(job.result!) as ChatJobResult;
    expect(result.via).toBe('conversation');
    expect(result.html).toBe('');
    expect(result.text).toBe(defaultAnswer('Write a research summary about Sydney Sweeney.'));
  }, 90_000);

  it('works on a shell page (only user-message classes and turn-action-controls)', async () => {
    fake.setMode({ mode: 'shell-page' });
    const id = await enqueue({ prompt: 'Shell page prompt' });
    await openChat();
    const job = await waitJob(id);
    expect(job.error).toBeNull();
    expect((JSON.parse(job.result!) as ChatJobResult).text).toContain('Answer to: Shell page prompt');
  }, 90_000);

  it('keeps only the answer after the last tool call (no preamble)', async () => {
    fake.setMode({ mode: 'no-markers', preamble: true });
    const id = await enqueue({ prompt: 'Research with web search' });
    await openChat();
    const job = await waitJob(id);
    const text = (JSON.parse(job.result!) as ChatJobResult).text;
    expect(text).toContain('Answer to: Research with web search');
    expect(text).not.toContain("I'm verifying");
  }, 90_000);

  it('strips canvas marks and needs two equal reads without end_turn', async () => {
    fake.setMode({ mode: 'no-markers', canvas: true, noEndTurn: true });
    const id = await enqueue({ prompt: 'Canvas prompt' });
    await openChat();
    const job = await waitJob(id);
    const text = (JSON.parse(job.result!) as ChatJobResult).text;
    expect(text).not.toContain(':::');
    expect(text).toContain('## Early Life');
  }, 90_000);

  it('types a long prompt instead of pasting it (no "Pasted text.txt")', async () => {
    fake.setMode({ mode: 'markers' });
    const long = 'Paragraph about the article. '.repeat(400) + 'END-OF-PROMPT';
    expect(long.length).toBeGreaterThan(8000);
    const id = await enqueue({ prompt: long });
    await openChat();
    const job = await waitJob(id, 90_000);
    expect(job.error).toBeNull();
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]!.pastedChips).toBe(0);
    expect(fake.received[0]!.prompt.replace(/\s+/g, ' ').trim()).toBe(long.replace(/\s+/g, ' ').trim());
  }, 120_000);

  it('rides out HTTP 429 on conversation reads', async () => {
    fake.setMode({ mode: 'no-markers', rateLimitFirst: 1 });
    const id = await enqueue({ prompt: 'Rate limited prompt' });
    await openChat();
    const job = await waitJob(id, 120_000);
    expect(job.error).toBeNull();
    expect(fake.conv429).toBe(1);
    expect((JSON.parse(job.result!) as ChatJobResult).text).toContain('Answer to: Rate limited prompt');
  }, 150_000);

  it('survives a hard rate limit without failing the prompt', async () => {
    fake.setMode({ mode: 'no-markers', rateLimitUntil: Date.now() + 25_000 });
    const id = await enqueue({ prompt: 'Hard rate limit', timeoutSec: 60 });
    await openChat();
    const job = await waitJob(id, 180_000);
    expect(job.error).toBeNull();
    expect(fake.conv429).toBeGreaterThan(0);
    // Every 429 raised the shared level; the successful read lowered it again.
    const slot = await sw.evaluate(async () => (await chrome.storage.local.get('readSlot')).readSlot as { level: number });
    expect(slot.level).toBeLessThanOrEqual(1);
  }, 200_000);

  it('runs two chats in parallel in two tabs', async () => {
    fake.setMode({ mode: 'no-markers', answerMs: 4000 });
    const a = await enqueue({ prompt: 'First parallel prompt' });
    const b = await enqueue({ prompt: 'Second parallel prompt' });
    await openChat();
    await openChat();
    const [ja, jb] = await Promise.all([waitJob(a, 120_000), waitJob(b, 120_000)]);
    const ra = JSON.parse(ja.result!) as ChatJobResult;
    const rb = JSON.parse(jb.result!) as ChatJobResult;
    expect(ra.text).toContain('First parallel prompt');
    expect(rb.text).toContain('Second parallel prompt');
    expect(ra.conversationUrl).not.toBe(rb.conversationUrl);
    expect(ja.lockedBy).not.toBe(jb.lockedBy);
  }, 150_000);

  it('recovers an answer that is already in the chat instead of sending again', async () => {
    fake.setMode({ mode: 'no-markers' });
    const prompt = 'Write exactly 5 FAQs about Sydney Sweeney.';
    const convId = fake.seedConversation(prompt, 'Q1?\nA1.');
    const id = await enqueue({ prompt, conversationUrl: `https://chatgpt.com/c/${convId}`, newChat: false, allowReuse: true });
    await openChat();
    const job = await waitJob(id);
    expect(job.error).toBeNull();
    const result = JSON.parse(job.result!) as ChatJobResult;
    expect(result.reusedExisting).toBe(true);
    expect(result.text).toBe('Q1?\nA1.');
    expect(result.conversationUrl).toBe(`https://chatgpt.com/c/${convId}`);
    expect(fake.received).toHaveLength(0);
  }, 90_000);

  it('continues an existing chat with a new prompt', async () => {
    fake.setMode({ mode: 'markers' });
    const convId = fake.seedConversation('Earlier prompt', 'Earlier answer');
    const id = await enqueue({ prompt: 'Follow-up prompt', conversationUrl: `https://chatgpt.com/c/${convId}`, newChat: false, allowReuse: true });
    await openChat();
    const job = await waitJob(id);
    expect(job.error).toBeNull();
    const result = JSON.parse(job.result!) as ChatJobResult;
    expect(result.reusedExisting).toBe(false);
    expect(result.conversationUrl).toBe(`https://chatgpt.com/c/${convId}`);
    expect(fake.conversations.get(convId)!.messages.filter((m) => m.role === 'user')).toHaveLength(2);
  }, 90_000);

  it('fails with CONVERSATION_LOST when the saved chat is gone', async () => {
    fake.setMode({ mode: 'no-markers' });
    const id = await enqueue({ prompt: 'Lost chat', conversationUrl: 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555', newChat: false });
    await openChat();
    const job = await waitJob(id, 120_000);
    expect(job.status).toBe('FAILED');
    expect(job.error).toMatch(/^CONVERSATION_LOST/);
    const result = JSON.parse(job.result!) as { debug?: { step?: string } };
    expect(result.debug?.step).toBe('failed');
  }, 150_000);

  it('attaches files before sending', async () => {
    fake.setMode({ mode: 'no-markers' });
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const { DATA_DIR } = await import('@/server/env');
    const dir = path.join(DATA_DIR, 'test-attachments');
    fs.mkdirSync(dir, { recursive: true });
    for (const n of [1, 2]) {
      fs.writeFileSync(path.join(dir, `p${n}.jpg`), await sharp({ create: { width: 60, height: 60, channels: 3, background: '#0a0' } }).jpeg().toBuffer());
    }
    const id = await enqueue({
      prompt: 'Check these photos',
      attachments: [
        { name: 'photo-1.jpg', mime: 'image/jpeg', path: 'test-attachments/p1.jpg' },
        { name: 'photo-2.jpg', mime: 'image/jpeg', path: 'test-attachments/p2.jpg' },
      ],
    });
    await openChat();
    const job = await waitJob(id, 90_000);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(job.error).toBeNull();
    expect(fake.received[0]!.attachments).toEqual(['photo-1.jpg', 'photo-2.jpg']);
  }, 120_000);

  it('returns a generated picture as a 1920x1080 JPEG', async () => {
    fake.setMode({ mode: 'markers', image: true });
    const id = await enqueue({ prompt: 'Create one wide picture', expect: 'images', imageCount: 1 });
    await openChat();
    const job = await waitJob(id, 120_000);
    expect(job.error).toBeNull();
    const result = JSON.parse(job.result!) as ChatJobResult;
    expect(result.imageFiles).toHaveLength(1);
    expect(result.imageFiles[0]).toMatchObject({ width: 1920, height: 1080 });
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { DATA_DIR } = await import('@/server/env');
    const sharp = (await import('sharp')).default;
    const meta = await sharp(fs.readFileSync(path.join(DATA_DIR, result.imageFiles[0]!.path))).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1920);
  }, 150_000);

  it('saves gallery pictures and returns publisher pictures as links', async () => {
    fake.setMode({
      mode: 'no-markers',
      gallery: { fetchable: [`${server.url}/img/a.png`, `${server.url}/img/b.png`], publisher: ['https://publisher.example/c.jpg'] },
    });
    const id = await enqueue({ prompt: 'Show photos of Sydney Sweeney', expect: 'gallery' });
    await openChat();
    const job = await waitJob(id, 150_000);
    expect(job.error).toBeNull();
    const result = JSON.parse(job.result!) as ChatJobResult;
    expect(result.imageFiles.length).toBe(2);
    expect(result.imageLinks.map((l) => l.url)).toEqual(['https://publisher.example/c.jpg']);
  }, 180_000);

  it('fails the job when its tab is closed', async () => {
    fake.setMode({ mode: 'no-markers', answerMs: 20_000 });
    const id = await enqueue({ prompt: 'Slow answer' });
    const page = await openChat();
    for (let i = 0; i < 100; i++) {
      const j = await prisma.queueJob.findUniqueOrThrow({ where: { id } });
      if (j.status === 'ACTIVE' && /sent|waiting-answer|waiting-prompt/.test(j.progress ?? '')) break;
      await sleep(300);
    }
    await page.close();
    const job = await waitJob(id, 30_000);
    expect(job.status).toBe('FAILED');
    expect(job.error).toContain('window was closed');
  }, 90_000);

  it('opens ChatGPT tabs by itself for waiting prompts and closes idle ones', async () => {
    fake.setMode({ mode: 'markers' });
    await sw.evaluate(async () => chrome.storage.local.set({ paused: false }));
    const id = await enqueue({ prompt: 'Auto-opened tab prompt' });
    await sw.evaluate(() => (self as unknown as { BAS: { statusTick: () => Promise<void> } }).BAS.statusTick());
    const job = await waitJob(id, 90_000);
    expect(job.error).toBeNull();
    expect(context.pages().some((p) => p.url().startsWith('https://chatgpt.com/'))).toBe(true);
    // Idle for 20 s and nothing waiting: the managed tab is closed.
    for (let i = 0; i < 20 && context.pages().some((p) => p.url().startsWith('https://chatgpt.com/')); i++) {
      await sleep(2500);
      await sw.evaluate(() => (self as unknown as { BAS: { statusTick: () => Promise<void> } }).BAS.statusTick());
    }
    expect(context.pages().some((p) => p.url().startsWith('https://chatgpt.com/'))).toBe(false);
    await sw.evaluate(async () => chrome.storage.local.set({ paused: true }));
  }, 150_000);

  it('does not claim prompts in a logged-out tab', async () => {
    fake.setMode({ mode: 'markers', loggedOut: true });
    await openChat();
    await sleep(4000);
    const status = await prisma.workerStatus.findUnique({ where: { id: 'extension' } });
    expect(status).not.toBeNull();
    // A logged-out tab never claims a prompt.
    const id = await enqueue({ prompt: 'Should not be claimed' });
    await sleep(6000);
    const job = await prisma.queueJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe('WAITING');
  }, 60_000);
});
