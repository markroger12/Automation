import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaPragmas?: Promise<void> };

function create(): PrismaClient {
  const client = new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });
  return client;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? create();
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
  // WAL lets the dashboard read while the worker writes; busy_timeout waits instead of failing with SQLITE_BUSY.
  globalForPrisma.prismaPragmas = (async () => {
    try {
      await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    } catch {
      // The database may not exist yet (before `npm run setup`).
    }
  })();
}

export type { PrismaClient };
