import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb } from '../helpers/test-db';

setupTestDb();
const { prisma } = await import('@/server/db');
const { addKeywords, patchKeyword, deleteKeyword } = await import('@/server/workflow-service');
const { workflowTick, MAX_WRITE_AHEAD } = await import('@/worker/workflow/scheduler');

// A website whose /?p=<id> redirects to the post once it is "live".
const live = new Set<string>();
const site = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  const p = u.searchParams.get('p');
  if (u.pathname === '/' && p && live.has(p)) {
    res.writeHead(301, { location: `/post-${p}/` }).end();
  } else if (u.pathname.startsWith('/post-')) {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Post</h1>');
  } else if (u.pathname === '/feed/') {
    res.writeHead(200, { 'content-type': 'application/rss+xml' }).end('<rss><channel></channel></rss>');
  } else {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<p>home</p>');
  }
});

let websiteId = '';
let workflowId = '';
const T0 = new Date('2026-10-10T03:00:00Z'); // 08:00 Pakistan time

async function keywords() {
  return prisma.workflowKeyword.findMany({ where: { workflowId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { task: true } });
}

describe('Workflow scheduler', () => {
  beforeAll(async () => {
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    const port = (site.address() as AddressInfo).port;
    const website = await prisma.website.create({ data: { name: 'Site', url: `http://127.0.0.1:${port}`, adminUrl: `http://127.0.0.1:${port}/wp-admin`, siteTimezone: 'Europe/Berlin' } });
    websiteId = website.id;
    const wf = await prisma.workflow.create({ data: { websiteId, isActive: true, publishTimes: JSON.stringify(['09:00', '21:00']) } });
    workflowId = wf.id;
  });
  afterAll(async () => {
    site.close();
    await prisma.$disconnect();
  });

  it('adds keywords with kinds from wording and CSV, and skips duplicates', async () => {
    const r1 = await addKeywords(websiteId, { text: 'sydney sweeney net worth | sydney sweeney age | Sydney Sweeney Net Worth\nbest budget phones\nZendaya\nsydney sweeney  NET worth' });
    expect(r1).toEqual({ added: 3, duplicates: ['sydney sweeney  NET worth'] });
    const r2 = await addKeywords(websiteId, { csv: 'Keyword,Secondary Keywords,Title,Kind\n"Tom Holland",tom holland age;tom holland height,,celebrity\nzendaya,,,\n' });
    expect(r2.added).toBe(1);
    expect(r2.duplicates).toEqual(['zendaya']);
    const kws = await keywords();
    expect(kws.map((k) => [k.keyword, k.kind, k.kindSource])).toEqual([
      ['sydney sweeney net worth', 'CELEBRITY', 'rules'],
      ['best budget phones', 'TIGRAM', 'rules'],
      ['Zendaya', 'UNKNOWN', null],
      ['Tom Holland', 'CELEBRITY', 'csv'],
    ]);
    expect(JSON.parse(kws[0]!.secondaryKeywords)).toEqual(['sydney sweeney age']);
    expect(kws[0]!.title).toBe('Sydney Sweeney Net Worth');
    expect(JSON.parse(kws[3]!.secondaryKeywords)).toEqual(['tom holland age', 'tom holland height']);
    // Zendaya is undecided and was looked up already (no network in tests): it waits for a choice by hand.
    await prisma.workflowKeyword.update({ where: { id: kws[2]!.id }, data: { kindSource: 'wikidata', kindNote: 'Wikidata: no match' } });
  });

  it('gives each decided keyword its own slot and starts writing it as a draft', async () => {
    await workflowTick(T0);
    const kws = await keywords();
    const [a, b, c, d] = kws;
    expect(a!.publishAt!.toISOString()).toBe('2026-10-10T04:00:00.000Z'); // 09:00 PKT
    expect(b!.publishAt!.toISOString()).toBe('2026-10-10T16:00:00.000Z'); // 21:00 PKT
    expect(c!.publishAt).toBeNull();
    expect(c!.state).toBe('WAITING');
    expect(d!.publishAt!.toISOString()).toBe('2026-10-11T04:00:00.000Z');
    expect([a, b, d].map((k) => k!.state)).toEqual(['WRITING', 'WRITING', 'WRITING']);
    expect(a!.task!.moduleKey).toBe('celebrity-writer');
    expect(b!.task!.moduleKey).toBe('tigram-writer');
    expect(a!.task!.autoApprove).toBe(true);
    expect(a!.task!.exampleTitle).toBe('Sydney Sweeney Net Worth');
    // A second tick changes nothing.
    await workflowTick(T0);
    expect(await prisma.articleTask.count()).toBe(3);
  });

  it('chooses a kind by hand, reorders and deletes', async () => {
    let kws = await keywords();
    const zendaya = kws[2]!;
    await expect(patchKeyword(kws[0]!.id, { kind: 'TIGRAM' })).rejects.toThrow(/already has an article/);
    await patchKeyword(zendaya.id, { kind: 'CELEBRITY' });
    await patchKeyword(zendaya.id, { move: 'top' });
    kws = await keywords();
    expect(kws[0]!.keyword).toBe('Zendaya');
    expect(kws[0]!.kindSource).toBe('manual');
    await expect(deleteKeyword(kws[1]!.id)).rejects.toThrow(/being written/);
  });

  it('keeps drafts as drafts unless the website may publish by itself', async () => {
    const kws = await keywords();
    const a = kws.find((k) => k.keyword === 'sydney sweeney net worth')!;
    await prisma.articleTask.update({ where: { id: a.taskId! }, data: { status: 'DRAFT_CREATED', wpPostId: 101 } });
    await workflowTick(T0);
    expect((await prisma.workflowKeyword.findUniqueOrThrow({ where: { id: a.id } })).state).toBe('READY');
    expect(await prisma.queueJob.count({ where: { queue: 'workflow' } })).toBe(0);

    await prisma.website.update({ where: { id: websiteId }, data: { canPublish: true } });
    await workflowTick(T0);
    await workflowTick(T0);
    const jobs = await prisma.queueJob.findMany({ where: { queue: 'workflow' } });
    expect(jobs.map((j) => j.name)).toEqual(['schedule-post']);
    expect(JSON.parse(jobs[0]!.data)).toEqual({ keywordId: a.id });
  });

  it('retries a failed article up to 3 times; it takes the next free slot', async () => {
    const kws = await keywords();
    const b = kws.find((k) => k.keyword === 'best budget phones')!;
    await prisma.articleTask.update({ where: { id: b.taskId! }, data: { status: 'FAILED', error: 'ChatGPT did not answer' } });
    await workflowTick(T0);
    const after = await prisma.workflowKeyword.findUniqueOrThrow({ where: { id: b.id }, include: { task: true } });
    expect(after.state).toBe('WRITING');
    expect(after.attempts).toBe(2);
    expect(after.task!.status).toBe('QUEUED');
    expect(after.publishAt).not.toBeNull();
    expect(after.lastError).toBe('ChatGPT did not answer');

    await prisma.workflowKeyword.update({ where: { id: b.id }, data: { attempts: 3 } });
    await prisma.articleTask.update({ where: { id: b.taskId! }, data: { status: 'FAILED', error: 'Still failing' } });
    await workflowTick(T0);
    const failed = await prisma.workflowKeyword.findUniqueOrThrow({ where: { id: b.id } });
    expect(failed.state).toBe('FAILED');
    expect(failed.publishAt).toBeNull();

    // Put back in line: the same article is retried, never written twice.
    await patchKeyword(b.id, { state: 'WAITING' });
    const back = await prisma.workflowKeyword.findUniqueOrThrow({ where: { id: b.id }, include: { task: true } });
    expect(back.state).toBe('WRITING');
    expect(back.taskId).toBe(b.taskId);
    expect(back.task!.status).toBe('QUEUED');
  });

  it('notices a scheduled post once it is live, then finishes it', async () => {
    const a = (await keywords()).find((k) => k.keyword === 'sydney sweeney net worth')!;
    await prisma.workflowKeyword.update({ where: { id: a.id }, data: { state: 'SCHEDULED', publishAt: new Date('2026-10-10T04:00:00Z') } });
    const later = new Date('2026-10-10T04:05:00Z');
    await workflowTick(later);
    expect((await prisma.workflowKeyword.findUniqueOrThrow({ where: { id: a.id } })).state).toBe('SCHEDULED');
    live.add('101');
    await workflowTick(later);
    const done = await prisma.workflowKeyword.findUniqueOrThrow({ where: { id: a.id }, include: { task: true } });
    expect(done.publishedUrl).toMatch(/\/post-101\/$/);
    expect(done.task!.wpPostUrl).toBe(done.publishedUrl);
    await workflowTick(later);
    expect((await prisma.workflowKeyword.findUniqueOrThrow({ where: { id: a.id } })).state).toBe('DONE');
  });

  it(`writes at most ${MAX_WRITE_AHEAD} articles ahead, and waits for the write-ahead window`, async () => {
    await addKeywords(websiteId, { text: Array.from({ length: 12 }, (_, i) => `gadget review ${i + 1}`).join('\n') });
    await workflowTick(T0);
    const kws = await keywords();
    const ahead = kws.filter((k) => k.state === 'WRITING' || k.state === 'READY');
    expect(ahead.length).toBe(MAX_WRITE_AHEAD);
    expect(kws.filter((k) => k.state === 'WAITING').length).toBeGreaterThan(0);

    // Write-ahead of 12 hours: a keyword whose slot is days away is not started.
    await prisma.workflow.update({ where: { id: workflowId }, data: { writeAheadHours: 12 } });
    await prisma.workflowKeyword.updateMany({ where: { workflowId, state: { in: ['WRITING', 'READY'] } }, data: { state: 'DONE' } });
    const before = await prisma.articleTask.count();
    await workflowTick(T0);
    const started = (await prisma.articleTask.count()) - before;
    const waiting = (await keywords()).filter((k) => k.state === 'WRITING');
    expect(started).toBe(waiting.length);
    for (const k of waiting) expect(k.publishAt!.getTime() - T0.getTime()).toBeLessThanOrEqual(12 * 3600_000);
  });

  it('does nothing while the workflow is off', async () => {
    await prisma.workflow.update({ where: { id: workflowId }, data: { isActive: false } });
    await addKeywords(websiteId, { text: 'jenna ortega age' });
    const before = await prisma.articleTask.count();
    await workflowTick(T0);
    expect(await prisma.articleTask.count()).toBe(before);
  });
});
