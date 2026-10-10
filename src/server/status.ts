import { prisma } from './db';
import { getInternal } from './settings';
import { parseJson } from '@/lib/json';

export const WORKER_STATUS_ID = 'worker';
export const EXTENSION_STATUS_ID = 'extension';
export const WORKER_ONLINE_MS = 30_000;
export const EXTENSION_ONLINE_MS = 75_000;

export type ExtensionInfo = { version?: string; tabs?: number; paused?: boolean; automationChrome?: boolean; userAgent?: string };
export type WorkerInfo = { pid?: number; host?: string; startedAt?: string; version?: string };

const RUNNING_STATUSES = [
  'OPENING_CHATGPT',
  'GENERATING_TITLES',
  'RESEARCHING',
  'WRITING_ARTICLE',
  'OPTIMIZING',
  'GENERATING_FAQS',
  'GENERATING_BIO_TABLE',
  'SEO_CHECKING',
  'OPENING_WORDPRESS',
  'CREATING_DRAFT',
  'RUNNING_RANKMATH',
] as const;

export async function getSystemStatus() {
  const [worker, extension, keyHash, running, queued, waitingChatgpt, activeChatgpt] = await Promise.all([
    prisma.workerStatus.findUnique({ where: { id: WORKER_STATUS_ID } }),
    prisma.workerStatus.findUnique({ where: { id: EXTENSION_STATUS_ID } }),
    getInternal<string | null>('extensionKeyHash', null),
    prisma.articleTask.count({ where: { status: { in: [...RUNNING_STATUSES] } } }),
    prisma.articleTask.count({ where: { status: 'QUEUED' } }),
    prisma.queueJob.count({ where: { queue: 'chatgpt', status: 'WAITING' } }),
    prisma.queueJob.count({ where: { queue: 'chatgpt', status: 'ACTIVE' } }),
  ]);
  const now = Date.now();
  const extInfo = parseJson<ExtensionInfo>(extension?.info, {});
  return {
    worker: {
      online: !!worker && now - worker.lastSeenAt.getTime() < WORKER_ONLINE_MS,
      lastSeenAt: worker?.lastSeenAt.toISOString() ?? null,
      info: parseJson<WorkerInfo>(worker?.info, {}),
    },
    extension: {
      online: !!keyHash && !!extension && now - extension.lastSeenAt.getTime() < EXTENSION_ONLINE_MS,
      lastSeenAt: extension?.lastSeenAt.toISOString() ?? null,
      version: extInfo.version ?? null,
      tabs: extInfo.tabs ?? 0,
      paused: !!extInfo.paused,
      connected: !!keyHash,
    },
    counts: { running, queued, waitingChatgpt, activeChatgpt },
  };
}

export type SystemStatus = Awaited<ReturnType<typeof getSystemStatus>>;
