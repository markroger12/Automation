import { route, readJson } from '@/server/api';
import { prisma } from '@/server/db';
import { websiteInputSchema, defaultAdminUrl } from '@/lib/website-schema';

export const dynamic = 'force-dynamic';

function profileDirName(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base || 'site'}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GET = route(async () => {
  const websites = await prisma.website.findMany({
    orderBy: { name: 'asc' },
    include: {
      profile: true,
      _count: { select: { categories: true, tasks: true } },
      workflow: { select: { isActive: true } },
    },
  });
  return { websites };
});

export const POST = route(async ({ req }) => {
  const input = await readJson(req, websiteInputSchema);
  const website = await prisma.website.create({
    data: {
      name: input.name,
      url: input.url,
      adminUrl: input.adminUrl || defaultAdminUrl(input.url),
      editorType: input.editorType,
      language: input.language,
      targetCountry: input.targetCountry || null,
      isActive: input.isActive,
      celebrityImages: input.celebrityImages,
      tigramImages: input.tigramImages,
      internalLinkText: input.internalLinkText || (input.language === 'German' ? 'Das könnte Ihnen gefallen:' : 'Also read:'),
      searchConsoleProperty: input.searchConsoleProperty || null,
      siteTimezone: input.siteTimezone || null,
      profile: { create: { name: input.name, kind: 'WORDPRESS', directory: profileDirName(input.name) } },
    },
    include: { profile: true },
  });
  return { website };
});
