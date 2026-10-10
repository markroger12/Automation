/**
 * The worker: the only process that opens browsers. Runs pipelines, ChatGPT job housekeeping,
 * WordPress automation, control jobs and the workflow scheduler. One worker per data/ folder.
 */
import '@/server/env';
import { prisma } from '@/server/db';
import { pruneJobs, recoverJobs } from '@/server/queue';
import { errorMessage, writeLog } from '@/server/log';
import { seedSettings } from '@/server/settings';
import { seedPrompts } from '@/server/prompts';
import { WORKER_ID, currentSettings, isStopping, markStopping, runShutdownHooks } from './runtime';
import { acquireWorkerLock, releaseWorkerLock, workerHeartbeat } from './lock';
import { startQueueRunner, type QueueRunner } from './queue-runner';
import { handleControlJob } from './control';
import { chatgptWatchTick } from './chatgpt-watch';
import { runArticleJob } from './engine/run-job';
import { registerWorkerModules, extraRunners, extraTicks } from './modules';

const runners: QueueRunner[] = [];
const timers: NodeJS.Timeout[] = [];

function every(ms: number, name: string, fn: () => Promise<void>) {
  let busy = false;
  const tick = async () => {
    if (busy || isStopping()) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[${name}]`, err);
    } finally {
      busy = false;
    }
  };
  timers.push(setInterval(tick, ms));
  setTimeout(tick, 1500);
}

async function main() {
  console.log(`\x1b[35mBlog Automation Studio worker\x1b[0m ${WORKER_ID}`);
  await acquireWorkerLock();
  await seedSettings();
  await seedPrompts();
  const recovered = await recoverJobs();
  await writeLog({
    category: 'QUEUE',
    message: `Worker started (pid ${process.pid}). Re-queued ${recovered.requeued} article run(s), closed ${recovered.failed} stale job(s).`,
  });

  timers.push(
    setInterval(async () => {
      try {
        if (!(await workerHeartbeat())) {
          console.error('Another worker took over this data folder. Stopping.');
          await shutdown(1);
        }
      } catch (err) {
        console.error('Heartbeat failed', errorMessage(err));
      }
    }, 5000),
  );

  registerWorkerModules();

  runners.push(
    startQueueRunner({
      queue: 'article',
      concurrency: async () => (await currentSettings()).taskConcurrency,
      handle: runArticleJob,
      heartbeatMs: 10_000,
    }),
    startQueueRunner({ queue: 'control', concurrency: () => 3, handle: handleControlJob, heartbeatMs: 10_000 }),
    ...extraRunners(),
  );

  every(10_000, 'chatgpt-watch', chatgptWatchTick);
  for (const t of extraTicks()) every(t.ms, t.name, t.fn);
  every(6 * 3600_000, 'housekeeping', async () => {
    const jobs = await pruneJobs(14);
    const logs = await prisma.log.deleteMany({ where: { level: 'DEBUG', createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } });
    if (jobs || logs.count) console.log(`Housekeeping: removed ${jobs} old job(s) and ${logs.count} old debug log(s).`);
  });
}

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  markStopping();
  console.log('Worker stopping…');
  for (const t of timers) clearInterval(t);
  try {
    // Article runs in flight continue from their last completed stage on the next start.
    await prisma.queueJob.updateMany({
      where: { queue: 'article', status: 'ACTIVE', lockedBy: WORKER_ID },
      data: { status: 'WAITING', lockedBy: null, heartbeatAt: null, startedAt: null, runAt: new Date() },
    });
    await releaseWorkerLock();
  } catch (err) {
    console.error('Shutdown bookkeeping failed', errorMessage(err));
  }
  await Promise.all(runners.map((r) => r.stop()));
  await runShutdownHooks();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection', err));

main().catch(async (err) => {
  console.error('\x1b[31mWorker failed to start:\x1b[0m', errorMessage(err));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
