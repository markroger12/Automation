import { route, query } from '@/server/api';
import { prisma } from '@/server/db';
import { seedPrompts } from '@/server/prompts';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  await seedPrompts();
  const moduleKey = query(req, 'module');
  const rows = await prisma.promptTemplate.findMany({ where: moduleKey ? { moduleKey } : {}, orderBy: [{ moduleKey: 'asc' }] });
  const modules = MODULES.filter((m) => m.prompts.length).map((m) => ({
    key: m.key,
    name: m.name,
    prompts: m.prompts.map((p) => {
      const row = rows.find((r) => r.moduleKey === m.key && r.key === p.key);
      return {
        id: row?.id ?? null,
        key: p.key,
        name: p.name,
        description: p.description,
        variables: p.variables,
        content: row?.content ?? p.defaultContent,
        isDefault: !row || row.content === p.defaultContent,
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  }));
  return { modules };
});
