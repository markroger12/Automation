import { prisma } from '@/server/db';
import { parseJson } from '@/lib/json';
import { ConversationLostError, LoginRequiredError, NoImagesError, TaskCancelledError, UsageLimitError } from '@/server/errors';
import type { ChatAttachment, ChatJobData, ChatJobFailure, ChatJobResult } from '@/server/chatgpt-jobs';
import { isStopping, sleep, currentSettings } from '../runtime';

/** If no tab claims a prompt for this long, the task waits for someone to open the Automation Chrome. */
export const UNCLAIMED_LIMIT_MS = 30 * 60_000;

export class WorkerStoppingError extends Error {
  constructor() {
    super('The worker is stopping; the stage continues on the next start.');
    this.name = 'WorkerStoppingError';
  }
}

/** A failed ChatGPT job, carrying the extension's debug snapshot for the task log. */
export class ChatJobError extends Error {
  constructor(
    message: string,
    public code: string,
    public debug?: unknown,
  ) {
    super(message);
    this.name = 'ChatJobError';
  }
}

export type AskRequest = {
  taskId: string | null;
  stageKey: string;
  label: string;
  prompt: string;
  conversationUrl: string | null;
  newChat: boolean;
  allowReuse: boolean;
  fresh?: boolean;
  expect?: ChatJobData['expect'];
  imageCount?: number;
  attachments?: ChatAttachment[];
  onProgress?: (step: string) => Promise<void> | void;
};

export type AskResult = ChatJobResult & { jobId: string; durationMs: number };

/** Puts a prompt into the "chatgpt" queue for the extension and waits for the answer. */
export async function askViaExtension(req: AskRequest): Promise<AskResult> {
  const settings = await currentSettings();
  const data: ChatJobData = {
    prompt: req.prompt,
    conversationUrl: req.newChat ? null : req.conversationUrl,
    newChat: req.newChat || !req.conversationUrl,
    allowReuse: req.allowReuse,
    fresh: req.fresh,
    expect: req.expect ?? 'text',
    imageCount: req.imageCount,
    attachments: req.attachments,
    timeoutSec: settings.generationTimeoutSec,
    label: req.label,
    stageKey: req.stageKey,
    requiredFeatures: [
      'text',
      ...(req.prompt.length > 8000 ? ['long-prompt'] : []),
      ...(req.expect === 'images' ? ['images'] : req.expect === 'gallery' ? ['gallery'] : []),
      ...(req.attachments?.length ? ['attachments'] : []),
    ],
  };
  const started = Date.now();
  const job = await prisma.queueJob.create({ data: { queue: 'chatgpt', name: 'prompt', taskId: req.taskId, data: JSON.stringify(data) } });
  let waitingSince = Date.now();
  let lastStatus = job.status;
  let lastStep = '';

  try {
    for (;;) {
      if (isStopping()) throw new WorkerStoppingError();
      await sleep(1500);
      const row = await prisma.queueJob.findUnique({ where: { id: job.id } });
      if (!row) throw new Error('The ChatGPT job disappeared.');
      if (req.taskId) {
        const task = await prisma.articleTask.findUnique({ where: { id: req.taskId }, select: { cancelRequested: true } });
        if (task?.cancelRequested) {
          await prisma.queueJob.updateMany({ where: { id: job.id, status: { in: ['WAITING', 'ACTIVE'] } }, data: { status: 'FAILED', error: 'CANCELLED: task cancelled', finishedAt: new Date() } });
          throw new TaskCancelledError();
        }
      }
      if (row.status === 'COMPLETED') {
        const result = parseJson<ChatJobResult>(row.result, { text: '', html: '', conversationUrl: null, reusedExisting: false, imageFiles: [], imageLinks: [] });
        return { ...result, imageFiles: result.imageFiles ?? [], imageLinks: result.imageLinks ?? [], jobId: job.id, durationMs: Date.now() - started };
      }
      if (row.status === 'FAILED') {
        const f = parseJson<Partial<ChatJobFailure>>(row.result, {});
        const code = f.code ?? (/^([A-Z_]+):/.exec(row.error ?? '')?.[1] as ChatJobFailure['code'] | undefined) ?? 'ERROR';
        const message = f.message || row.error || 'ChatGPT job failed';
        throw mapFailure(code, message, f.debug);
      }
      if (row.status === 'WAITING') {
        if (lastStatus !== 'WAITING') waitingSince = Date.now();
        if (Date.now() - waitingSince > UNCLAIMED_LIMIT_MS) {
          await prisma.queueJob.updateMany({ where: { id: job.id, status: 'WAITING' }, data: { status: 'FAILED', error: 'No ChatGPT tab took the prompt for 30 minutes.', finishedAt: new Date() } });
          throw new LoginRequiredError('chatgpt', 'No ChatGPT tab took the prompt for 30 minutes — open the Automation Chrome (and log in to ChatGPT there).');
        }
      } else if (row.status === 'ACTIVE' && req.onProgress) {
        const step = parseJson<{ step?: string }>(row.progress, {}).step ?? '';
        if (step && step !== lastStep) {
          lastStep = step;
          await req.onProgress(step);
        }
      }
      lastStatus = row.status;
    }
  } catch (err) {
    if (err instanceof WorkerStoppingError) {
      // Leave nothing behind for a tab to pick up: the resumed stage asks again (and recovers the answer).
      await prisma.queueJob.updateMany({ where: { id: job.id, status: 'WAITING' }, data: { status: 'FAILED', error: 'worker stopping', finishedAt: new Date() } }).catch(() => undefined);
    }
    throw err;
  }
}

export function mapFailure(code: string, message: string, debug?: unknown): Error {
  switch (code) {
    case 'LOGIN':
      return new LoginRequiredError('chatgpt', `ChatGPT needs a login or a human check in the Automation Chrome: ${message}`);
    case 'CONVERSATION_LOST':
      return Object.assign(new ConversationLostError(message), { debug });
    case 'USAGE_LIMIT':
      return new UsageLimitError(message);
    default:
      if (/NO_IMAGES/.test(message)) return Object.assign(new NoImagesError(message.replace(/^.*NO_IMAGES:\s*/, '')), { debug });
      return new ChatJobError(message, code, debug);
  }
}
