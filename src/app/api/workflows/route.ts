import { route, query } from '@/server/api';
import { prisma } from '@/server/db';
import { getOrCreateWorkflow } from '@/server/workflow-service';

export const dynamic = 'force-dynamic';

const WEBSITE_FIELDS = { id: true, name: true, url: true, language: true, isActive: true, canPublish: true, siteTimezone: true, searchConsoleProperty: true, celebrityImages: true, tigramImages: true, profileId: true, defaultCategoryId: true } as const;

/** Without ?websiteId: the websites and whether their workflow is on. With it: that workflow and its keywords. */
export const GET = route(async ({ req }) => {
  const websites = await prisma.website.findMany({ orderBy: { name: 'asc' }, select: { ...WEBSITE_FIELDS, workflow: { select: { isActive: true } } } });
  const websiteId = query(req, 'websiteId');
  if (!websiteId) return { websites };
  const wf = await getOrCreateWorkflow(websiteId);
  const [workflow, website] = await Promise.all([
    prisma.workflow.findUnique({
      where: { id: wf.id },
      include: {
        keywords: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: { task: { select: { id: true, status: true, statusMessage: true, selectedTitle: true, wpPostId: true, wpEditUrl: true, wpPostUrl: true, moduleKey: true } } },
        },
      },
    }),
    prisma.website.findUnique({ where: { id: websiteId }, select: WEBSITE_FIELDS }),
  ]);
  return { websites, workflow, website };
});
