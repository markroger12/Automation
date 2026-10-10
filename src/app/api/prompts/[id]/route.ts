import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { getModule } from '@/modules/registry';
import { writeLog } from '@/server/log';

const schema = z.union([z.object({ content: z.string().min(10).max(100_000) }), z.object({ reset: z.literal(true) })]);

export const PUT = route<{ id: string }>(async ({ req, params, user }) => {
  const body = await readJson(req, schema);
  const row = await prisma.promptTemplate.findUnique({ where: { id: params.id } });
  if (!row) throw new ApiError(404, 'Prompt not found.');
  const def = getModule(row.moduleKey)?.prompts.find((p) => p.key === row.key);
  const content = 'reset' in body ? (def?.defaultContent ?? row.defaultContent ?? row.content) : body.content;
  await prisma.promptTemplate.update({ where: { id: row.id }, data: { content } });
  await writeLog({ category: 'SYSTEM', message: `${user.email} ${'reset' in body ? 'reset' : 'edited'} the prompt ${row.moduleKey}/${row.key}.` });
  return { ok: true, content };
});
