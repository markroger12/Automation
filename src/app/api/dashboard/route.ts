import { route } from '@/server/api';
import { prisma } from '@/server/db';
import { getSystemStatus } from '@/server/status';

export const dynamic = 'force-dynamic';

const taskSelect = {
  id: true,
  keyword: true,
  moduleKey: true,
  status: true,
  progress: true,
  statusMessage: true,
  currentStage: true,
  selectedTitle: true,
  seoScore: true,
  rankMathScore: true,
  wpEditUrl: true,
  createdAt: true,
  updatedAt: true,
  website: { select: { name: true } },
} as const;

export const GET = route(async () => {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [grouped, week, active, recent, system] = await Promise.all([
    prisma.articleTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.articleTask.count({ where: { createdAt: { gte: since } } }),
    prisma.articleTask.findMany({
      where: { status: { notIn: ['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: taskSelect,
    }),
    prisma.articleTask.findMany({
      where: { status: { in: ['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: taskSelect,
    }),
    getSystemStatus(),
  ]);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }
  return { total, week, byStatus, active, recent, system };
});
