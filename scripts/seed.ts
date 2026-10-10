import { seedSettings } from '../src/server/settings';
import { seedPrompts } from '../src/server/prompts';
import { prisma } from '../src/server/db';

async function main() {
  const s = await seedSettings();
  const p = await seedPrompts();
  console.log(`Settings: ${s} new. Prompts: ${p.created} created, ${p.updated} updated, ${p.kept} kept (edited).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
