import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from './db';
import { MEDIA_DIR, ensureDir, safeJoin, DATA_DIR } from './env';
import { parseJson, clipJson } from '@/lib/json';
import { EXTENSION_STATUS_ID } from './status';
import { getSettings } from './settings';
import { writeLog } from './log';
import { cleanConversationUrl, conversationIdOf, type ChatJobData, type ChatJobResult, type ChatImageFile } from './chatgpt-jobs';

const base = { version: z.string().max(40).default('?'), tabId: z.number().int().optional() };

const statusSchema = z.object({
  action: z.literal('status'),
  ...base,
  tabs: z.number().int().min(0).max(100).default(0),
  readyTabs: z.number().int().min(0).max(100).default(0),
  loginNeeded: z.boolean().default(false),
  paused: z.boolean().default(false),
  automationChrome: z.boolean().default(false),
  windowMode: z.string().max(20).optional(),
  userAgent: z.string().max(400).optional(),
});
const claimSchema = z.object({
  action: z.literal('claim'),
  ...base,
  tabId: z.number().int(),
  features: z.array(z.string().max(40)).max(40).default([]),
  conversationId: z.string().max(100).nullable().optional(),
  scriptVersion: z.string().max(40).optional(),
});
const progressSchema = z.object({
  action: z.literal('progress'),
  ...base,
  tabId: z.number().int(),
  jobId: z.string().max(60),
  step: z.string().max(80).default(''),
  debug: z.unknown().optional(),
  conversationUrl: z.string().max(500).nullable().optional(),
});
const imageSchema = z.object({ base64: z.string().max(25_000_000), width: z.number().optional(), height: z.number().optional(), mime: z.string().max(40).optional(), source: z.string().max(2000).optional() });
const completeSchema = z.object({
  action: z.literal('complete'),
  ...base,
  tabId: z.number().int(),
  jobId: z.string().max(60),
  text: z.string().max(2_000_000).default(''),
  html: z.string().max(4_000_000).default(''),
  via: z.string().max(40).optional(),
  conversationUrl: z.string().max(500).nullable().optional(),
  reusedExisting: z.boolean().default(false),
  images: z.array(imageSchema).max(20).default([]),
  imageLinks: z.array(z.object({ url: z.string().max(4000), width: z.number().default(0), height: z.number().default(0) })).max(40).default([]),
  debug: z.unknown().optional(),
});
const failSchema = z.object({
  action: z.literal('fail'),
  ...base,
  tabId: z.number().int(),
  jobId: z.string().max(60),
  code: z.enum(['LOGIN', 'CONVERSATION_LOST', 'USAGE_LIMIT', 'CANCELLED', 'ERROR']).default('ERROR'),
  message: z.string().max(4000).default(''),
  conversationUrl: z.string().max(500).nullable().optional(),
  debug: z.unknown().optional(),
});
const releaseSchema = z.object({ action: z.literal('release'), ...base, tabId: z.number().int(), jobId: z.string().max(60), reason: z.string().max(200).optional() });

export const agentSchema = z.discriminatedUnion('action', [statusSchema, claimSchema, progressSchema, completeSchema, failSchema, releaseSchema]);
export type AgentRequest = z.infer<typeof agentSchema>;

const lockOf = (tabId: number) => `ext:${tabId}`;

async function touchExtension(version: string, extra?: Record<string, unknown>) {
  const now = new Date();
  const existing = extra ? null : await prisma.workerStatus.findUnique({ where: { id: EXTENSION_STATUS_ID } });
  const info = extra ? { ...extra, version } : { ...parseJson<Record<string, unknown>>(existing?.info, {}), version };
  await prisma.workerStatus.upsert({
    where: { id: EXTENSION_STATUS_ID },
    create: { id: EXTENSION_STATUS_ID, lastSeenAt: now, info: JSON.stringify(info) },
    update: { lastSeenAt: now, info: JSON.stringify(info) },
  });
}

async function readAttachments(data: ChatJobData) {
  const out: { name: string; mime: string; base64: string }[] = [];
  for (const a of data.attachments ?? []) {
    const file = safeJoin(DATA_DIR, a.path);
    if (!file) continue;
    const buf = await fs.readFile(file);
    out.push({ name: a.name, mime: a.mime, base64: buf.toString('base64') });
  }
  return out;
}

export async function handleAgent(body: AgentRequest): Promise<Record<string, unknown>> {
  switch (body.action) {
    case 'status': {
      await touchExtension(body.version, {
        tabs: body.tabs,
        readyTabs: body.readyTabs,
        loginNeeded: body.loginNeeded,
        paused: body.paused,
        automationChrome: body.automationChrome,
        windowMode: body.windowMode,
        userAgent: body.userAgent,
      });
      const settings = await getSettings();
      const [waiting, active] = await Promise.all([
        prisma.queueJob.count({ where: { queue: 'chatgpt', status: 'WAITING', runAt: { lte: new Date() } } }),
        prisma.queueJob.count({ where: { queue: 'chatgpt', status: 'ACTIVE' } }),
      ]);
      return { ok: true, concurrency: settings.taskConcurrency, waiting, active, chatgptUrl: settings.chatgptUrl, serverTime: Date.now() };
    }

    case 'claim': {
      await touchExtension(body.version);
      const settings = await getSettings();
      const candidates = await prisma.queueJob.findMany({
        where: { queue: 'chatgpt', status: 'WAITING', runAt: { lte: new Date() } },
        orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      });
      const features = new Set(body.features);
      const usable = candidates.filter((j) => (parseJson<ChatJobData>(j.data, {} as ChatJobData).requiredFeatures ?? []).every((f) => features.has(f)));
      // Prefer the job whose chat is already open in this tab.
      const sorted = body.conversationId
        ? [...usable].sort((a, b) => Number(conversationIdOf(parseJson<ChatJobData>(b.data, {} as ChatJobData).conversationUrl) === body.conversationId) - Number(conversationIdOf(parseJson<ChatJobData>(a.data, {} as ChatJobData).conversationUrl) === body.conversationId))
        : usable;
      for (const job of sorted) {
        const now = new Date();
        const res = await prisma.queueJob.updateMany({
          where: { id: job.id, status: 'WAITING' },
          data: { status: 'ACTIVE', lockedBy: lockOf(body.tabId), startedAt: now, heartbeatAt: now, attempts: { increment: 1 }, progress: JSON.stringify({ step: 'claimed', at: now.toISOString(), tabId: body.tabId }) },
        });
        if (res.count !== 1) continue;
        const data = parseJson<ChatJobData>(job.data, {} as ChatJobData);
        return {
          job: {
            id: job.id,
            taskId: job.taskId,
            label: data.label,
            prompt: data.prompt,
            conversationUrl: data.newChat ? null : data.conversationUrl,
            newChat: !!data.newChat || !data.conversationUrl,
            allowReuse: !!data.allowReuse,
            expect: data.expect ?? 'text',
            imageCount: data.imageCount ?? 1,
            attachments: await readAttachments(data),
            timeoutSec: data.timeoutSec,
            chatgptUrl: settings.chatgptUrl,
          },
        };
      }
      return { job: null };
    }

    case 'progress': {
      await touchExtension(body.version);
      const job = await prisma.queueJob.findUnique({ where: { id: body.jobId } });
      if (!job || job.status !== 'ACTIVE' || job.lockedBy !== lockOf(body.tabId)) return { continue: false };
      if (job.taskId) {
        const task = await prisma.articleTask.findUnique({ where: { id: job.taskId }, select: { cancelRequested: true } });
        if (task?.cancelRequested) return { continue: false };
      }
      const conv = cleanConversationUrl(body.conversationUrl);
      const data = parseJson<ChatJobData>(job.data, {} as ChatJobData);
      const update: Record<string, unknown> = {
        heartbeatAt: new Date(),
        progress: clipJson({ step: body.step, at: new Date().toISOString(), tabId: body.tabId, debug: body.debug }, 4500),
      };
      // Once the prompt has a real chat, a re-claim (abandoned tab) must go back to that chat and recover.
      if (conv && (data.newChat || !data.conversationUrl || conversationIdOf(data.conversationUrl) !== conversationIdOf(conv)) && ['sent', 'waiting-prompt', 'waiting-answer', 'waiting-images', 'waiting-gallery', 'saving-gallery', 'recovering-answer'].includes(body.step)) {
        update.data = JSON.stringify({ ...data, conversationUrl: conv, newChat: false, allowReuse: data.fresh ? data.allowReuse : true });
      }
      const res = await prisma.queueJob.updateMany({ where: { id: job.id, status: 'ACTIVE', lockedBy: lockOf(body.tabId) }, data: update });
      return { continue: res.count === 1 };
    }

    case 'complete': {
      await touchExtension(body.version);
      const job = await prisma.queueJob.findUnique({ where: { id: body.jobId } });
      if (!job || job.status !== 'ACTIVE' || job.lockedBy !== lockOf(body.tabId)) return { ok: false, ignored: true };
      const files: ChatImageFile[] = [];
      if (body.images.length) {
        const rel = path.join('chatgpt', job.id);
        const dir = ensureDir(path.join(MEDIA_DIR, rel));
        for (let i = 0; i < body.images.length; i++) {
          const img = body.images[i]!;
          const buf = Buffer.from(img.base64, 'base64');
          if (buf.length < 100) continue;
          const name = `${i + 1}.jpg`;
          await fs.writeFile(path.join(dir, name), buf);
          files.push({ path: path.join('media', rel, name).replace(/\\/g, '/'), width: img.width ?? 0, height: img.height ?? 0, source: img.source });
        }
      }
      const result: ChatJobResult = {
        text: body.text,
        html: body.html,
        via: body.via,
        conversationUrl: cleanConversationUrl(body.conversationUrl),
        reusedExisting: body.reusedExisting,
        imageFiles: files,
        imageLinks: body.imageLinks,
      };
      const res = await prisma.queueJob.updateMany({
        where: { id: job.id, status: 'ACTIVE', lockedBy: lockOf(body.tabId) },
        data: { status: 'COMPLETED', result: JSON.stringify(result), finishedAt: new Date(), error: null, progress: clipJson({ step: 'complete', debug: body.debug }, 4500) },
      });
      return { ok: res.count === 1 };
    }

    case 'fail': {
      await touchExtension(body.version);
      const job = await prisma.queueJob.findUnique({ where: { id: body.jobId } });
      if (!job || job.status !== 'ACTIVE' || job.lockedBy !== lockOf(body.tabId)) return { ok: false, ignored: true };
      const res = await prisma.queueJob.updateMany({
        where: { id: job.id, status: 'ACTIVE', lockedBy: lockOf(body.tabId) },
        data: {
          status: 'FAILED',
          error: `${body.code}: ${body.message}`.slice(0, 4000),
          result: clipJson({ code: body.code, message: body.message, conversationUrl: cleanConversationUrl(body.conversationUrl), debug: body.debug }, 6000),
          finishedAt: new Date(),
        },
      });
      return { ok: res.count === 1 };
    }

    case 'release': {
      const job = await prisma.queueJob.findUnique({ where: { id: body.jobId } });
      if (!job || job.status !== 'ACTIVE' || job.lockedBy !== lockOf(body.tabId)) return { ok: false };
      const data = parseJson<ChatJobData>(job.data, {} as ChatJobData);
      await prisma.queueJob.updateMany({
        where: { id: job.id, status: 'ACTIVE', lockedBy: lockOf(body.tabId) },
        data: { status: 'WAITING', lockedBy: null, heartbeatAt: null, startedAt: null, data: JSON.stringify({ ...data, allowReuse: data.fresh ? data.allowReuse : true }) },
      });
      if (body.reason && job.taskId) await writeLog({ taskId: job.taskId, category: 'CHATGPT', level: 'DEBUG', message: `Prompt handed back by a tab (${body.reason}).` });
      return { ok: true };
    }
  }
}
