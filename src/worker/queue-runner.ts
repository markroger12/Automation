import type { QueueJob } from '@prisma/client';
import { claimNext, completeJob, failJob, heartbeat, type QueueName } from '@/server/queue';
import { errorMessage, writeLog } from '@/server/log';
import { WORKER_ID, isStopping, sleep } from './runtime';

export type JobHandler = (job: QueueJob, signal: AbortSignal) => Promise<unknown>;

type RunnerOptions = {
  queue: QueueName;
  concurrency: () => Promise<number> | number;
  handle: JobHandler;
  pollMs?: number;
  heartbeatMs?: number;
  /** Called when the handler throws; return true when the job state was already handled. */
  onError?: (job: QueueJob, err: unknown) => Promise<boolean> | boolean;
};

export type QueueRunner = { running: Map<string, { job: QueueJob; abort: AbortController; promise: Promise<void> }>; stop: () => Promise<void> };

/** Claims and runs jobs of one queue with a concurrency limit and a heartbeat per running job. */
export function startQueueRunner(opts: RunnerOptions): QueueRunner {
  const running: QueueRunner['running'] = new Map();
  const pollMs = opts.pollMs ?? 1000;
  const heartbeatMs = opts.heartbeatMs ?? 10_000;
  let stopped = false;

  async function runJob(job: QueueJob) {
    const abort = new AbortController();
    const beat = setInterval(() => void heartbeat(job.id).catch(() => undefined), heartbeatMs);
    const promise = (async () => {
      try {
        const result = await opts.handle(job, abort.signal);
        // During shutdown the job row was already put back for the next start; leave it alone.
        if (!isStopping()) await completeJob(job.id, result ?? null);
      } catch (err) {
        if (isStopping()) return;
        const handled = opts.onError ? await opts.onError(job, err) : false;
        if (!handled) {
          await failJob(job.id, errorMessage(err));
          await writeLog({ level: 'ERROR', category: 'QUEUE', taskId: job.taskId, message: `${opts.queue} job "${job.name}" failed: ${errorMessage(err)}` });
        }
      } finally {
        clearInterval(beat);
        running.delete(job.id);
      }
    })();
    running.set(job.id, { job, abort, promise });
  }

  (async () => {
    while (!stopped && !isStopping()) {
      try {
        const limit = await opts.concurrency();
        let claimed = false;
        while (running.size < limit && !isStopping()) {
          const job = await claimNext(opts.queue, WORKER_ID);
          if (!job) break;
          claimed = true;
          await runJob(job);
        }
        await sleep(claimed ? 200 : pollMs);
      } catch (err) {
        console.error(`[${opts.queue}] runner error`, err);
        await sleep(3000);
      }
    }
  })();

  return {
    running,
    stop: async () => {
      stopped = true;
    },
  };
}
