import os from 'node:os';
import { prisma } from '@/server/db';
import { parseJson } from '@/lib/json';
import { WORKER_STATUS_ID } from '@/server/status';
import { WORKER_ID, isPidAlive, sleep } from './runtime';

type LockInfo = { workerId: string; pid: number; host: string; startedAt: string };

const STALE_MS = 20_000;
const startedAt = new Date().toISOString();

function myInfo(): LockInfo {
  return { workerId: WORKER_ID, pid: process.pid, host: os.hostname(), startedAt };
}

/**
 * Only one worker may run per data/ folder. A fresh heartbeat row whose process is still alive means
 * another worker owns the folder. A worker that is shutting down releases the row first, and we wait a
 * little for a previous process that is still exiting (tsx watch restarts).
 */
export async function acquireWorkerLock(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await prisma.workerStatus.findUnique({ where: { id: WORKER_STATUS_ID } });
    if (row) {
      const info = parseJson<Partial<LockInfo>>(row.info, {});
      const fresh = Date.now() - row.lastSeenAt.getTime() < STALE_MS;
      const sameHost = !info.host || info.host === os.hostname();
      const alive = sameHost ? !!info.pid && isPidAlive(info.pid) : true;
      if (fresh && alive && info.workerId !== WORKER_ID) {
        if (attempt < 7) {
          await sleep(2000);
          continue;
        }
        throw new Error(
          `Another worker is already running for this data folder (pid ${info.pid ?? '?'} on ${info.host ?? '?'}). ` +
            'Only one worker may run at a time — do not start npm run dev:all twice.',
        );
      }
    }
    await prisma.workerStatus.upsert({
      where: { id: WORKER_STATUS_ID },
      create: { id: WORKER_STATUS_ID, lastSeenAt: new Date(), info: JSON.stringify(myInfo()) },
      update: { lastSeenAt: new Date(), info: JSON.stringify(myInfo()) },
    });
    return;
  }
}

/** Refreshes the heartbeat. Returns false when another worker took the folder over (we must exit). */
export async function workerHeartbeat(): Promise<boolean> {
  const row = await prisma.workerStatus.findUnique({ where: { id: WORKER_STATUS_ID } });
  const info = parseJson<Partial<LockInfo>>(row?.info, {});
  if (row && info.workerId && info.workerId !== WORKER_ID && Date.now() - row.lastSeenAt.getTime() < STALE_MS) return false;
  await prisma.workerStatus.upsert({
    where: { id: WORKER_STATUS_ID },
    create: { id: WORKER_STATUS_ID, lastSeenAt: new Date(), info: JSON.stringify(myInfo()) },
    update: { lastSeenAt: new Date(), info: JSON.stringify(myInfo()) },
  });
  return true;
}

export async function releaseWorkerLock(): Promise<void> {
  const row = await prisma.workerStatus.findUnique({ where: { id: WORKER_STATUS_ID } });
  const info = parseJson<Partial<LockInfo>>(row?.info, {});
  if (info.workerId === WORKER_ID) {
    await prisma.workerStatus.update({ where: { id: WORKER_STATUS_ID }, data: { lastSeenAt: new Date(0) } });
  }
}
