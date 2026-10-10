import { prisma } from './db';
import { MODULES, getModule } from '@/modules/registry';

/**
 * Seeds default prompts. A default is written once. Later default changes only replace rows that are still
 * byte-identical to the default they were seeded with — a prompt the user edited is never overwritten.
 */
export async function seedPrompts(): Promise<{ created: number; updated: number; kept: number }> {
  let created = 0;
  let updated = 0;
  let kept = 0;
  for (const mod of MODULES) {
    for (const def of mod.prompts) {
      const existing = await prisma.promptTemplate.findUnique({ where: { moduleKey_key: { moduleKey: mod.key, key: def.key } } });
      if (!existing) {
        await prisma.promptTemplate.create({
          data: {
            moduleKey: mod.key,
            key: def.key,
            name: def.name,
            description: def.description,
            content: def.defaultContent,
            defaultContent: def.defaultContent,
          },
        });
        created++;
        continue;
      }
      const meta = { name: def.name, description: def.description };
      if (existing.defaultContent === def.defaultContent) {
        if (existing.name !== def.name || existing.description !== def.description) {
          await prisma.promptTemplate.update({ where: { id: existing.id }, data: meta });
        }
        continue;
      }
      const unedited = existing.defaultContent !== null && existing.content === existing.defaultContent;
      if (unedited) {
        await prisma.promptTemplate.update({
          where: { id: existing.id },
          data: { ...meta, content: def.defaultContent, defaultContent: def.defaultContent },
        });
        updated++;
      } else {
        // Edited by the user: keep their text, remember the new default for "Reset to default".
        await prisma.promptTemplate.update({ where: { id: existing.id }, data: { ...meta, defaultContent: def.defaultContent } });
        kept++;
      }
    }
  }
  return { created, updated, kept };
}

/** The current text of a prompt (falls back to the built-in default when the row is missing). */
export async function getPromptContent(moduleKey: string, key: string): Promise<string> {
  const row = await prisma.promptTemplate.findUnique({ where: { moduleKey_key: { moduleKey, key } } });
  if (row) return row.content;
  const def = getModule(moduleKey)?.prompts.find((p) => p.key === key);
  if (!def) throw new Error(`Unknown prompt ${moduleKey}/${key}`);
  return def.defaultContent;
}
