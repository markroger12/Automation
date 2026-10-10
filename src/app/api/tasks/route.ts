import type { Prisma, TaskStatus } from '@prisma/client';
import { route, readJson, query } from '@/server/api';
import { prisma } from '@/server/db';
import { createTasksSchema } from '@/lib/task-input';
import { createTaskFromInput, taskListSelect } from '@/server/task-service';
import { TASK_STATUSES } from '@/lib/status';

export const dynamic = 'force-dynamic';

const FINISHED: TaskStatus[] = ['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'];

export const GET = route(async ({ req }) => {
  const view = query(req, 'view') ?? 'all';
  const status = query(req, 'status');
  const moduleKey = query(req, 'module');
  const websiteId = query(req, 'website');
  const q = query(req, 'q');
  const cursor = query(req, 'cursor');
  const limit = Math.min(200, Number(query(req, 'limit') ?? 50) || 50);
  const where: Prisma.ArticleTaskWhereInput = {};
  if (view === 'queue') where.status = { notIn: FINISHED };
  if (status && (TASK_STATUSES as readonly string[]).includes(status)) where.status = status as TaskStatus;
  if (moduleKey) where.moduleKey = moduleKey;
  if (websiteId) where.websiteId = websiteId;
  if (q) where.OR = [{ keyword: { contains: q } }, { selectedTitle: { contains: q } }];
  const tasks = await prisma.articleTask.findMany({
    where,
    orderBy: view === 'queue' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: taskListSelect,
  });
  const hasMore = tasks.length > limit;
  const page = hasMore ? tasks.slice(0, limit) : tasks;
  const total = await prisma.articleTask.count({ where });
  return { tasks: page, nextCursor: hasMore ? page[page.length - 1]!.id : null, total };
});

export const POST = route(async ({ req, user }) => {
  const { tasks } = await readJson(req, createTasksSchema);
  const created: string[] = [];
  for (const t of tasks) created.push((await createTaskFromInput(t, user.id)).id);
  return { created: created.length, ids: created };
});
