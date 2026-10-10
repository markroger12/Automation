import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { route, query } from '@/server/api';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
const categories = ['SYSTEM', 'BROWSER', 'CHATGPT', 'WORDPRESS', 'RANKMATH', 'SEO', 'QUEUE', 'SESSION'] as const;

export const GET = route(async ({ req }) => {
  const level = z.enum(levels).optional().parse(query(req, 'level'));
  const minLevel = z.enum(levels).optional().parse(query(req, 'minLevel'));
  const category = z.enum(categories).optional().parse(query(req, 'category'));
  const taskId = query(req, 'taskId');
  const q = query(req, 'q');
  const cursor = query(req, 'cursor');
  const limit = Math.min(500, Math.max(10, Number(query(req, 'limit') ?? 100) || 100));

  const where: Prisma.LogWhereInput = {};
  if (level) where.level = level;
  if (minLevel) where.level = { in: levels.slice(levels.indexOf(minLevel)) as unknown as (typeof levels)[number][] };
  if (category) where.category = category;
  if (taskId) where.taskId = taskId;
  if (q) where.message = { contains: q };

  const logs = await prisma.log.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { task: { select: { keyword: true } } },
  });
  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;
  return {
    logs: page.map((l) => ({
      id: l.id,
      taskId: l.taskId,
      keyword: l.task?.keyword ?? null,
      level: l.level,
      category: l.category,
      stage: l.stage,
      message: l.message,
      data: l.data,
      screenshotPath: l.screenshotPath,
      createdAt: l.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
});

export const DELETE = route(
  async ({ req }) => {
    const days = Math.max(0, Number(query(req, 'olderThanDays') ?? 30) || 30);
    const res = await prisma.log.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
    return { deleted: res.count };
  },
  { admin: true },
);
