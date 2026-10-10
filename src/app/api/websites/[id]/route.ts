import { ApiError, route, readJson } from '@/server/api';
import { prisma } from '@/server/db';
import { enqueue } from '@/server/queue';
import { websiteInputSchema, defaultAdminUrl } from '@/lib/website-schema';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params }) => {
  const website = await prisma.website.findUnique({
    where: { id: params.id },
    include: { profile: true, categories: { orderBy: { name: 'asc' } }, workflow: true },
  });
  if (!website) throw new ApiError(404, 'Website not found.');
  return { website };
});

export const PUT = route<{ id: string }>(async ({ req, params, user }) => {
  const input = await readJson(req, websiteInputSchema.partial());
  const current = await prisma.website.findUnique({ where: { id: params.id } });
  if (!current) throw new ApiError(404, 'Website not found.');
  if (input.canPublish !== undefined && input.canPublish !== current.canPublish && user.role !== 'ADMIN') {
    throw new ApiError(403, 'Only an admin can change whether a website may publish by itself.');
  }
  if (input.defaultCategoryId) {
    const cat = await prisma.category.findFirst({ where: { id: input.defaultCategoryId, websiteId: params.id } });
    if (!cat) throw new ApiError(400, 'That category does not belong to this website.');
  }
  const website = await prisma.website.update({
    where: { id: params.id },
    data: {
      ...input,
      adminUrl: input.adminUrl === '' ? defaultAdminUrl(input.url ?? current.url) : input.adminUrl,
      targetCountry: input.targetCountry === '' ? null : input.targetCountry,
      searchConsoleProperty: input.searchConsoleProperty === '' ? null : input.searchConsoleProperty,
    },
    include: { profile: true },
  });
  return { website };
});

export const DELETE = route<{ id: string }>(async ({ params }) => {
  const website = await prisma.website.findUnique({ where: { id: params.id } });
  if (!website) throw new ApiError(404, 'Website not found.');
  const running = await prisma.articleTask.count({
    where: { websiteId: params.id, status: { notIn: ['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'] } },
  });
  if (running > 0) throw new ApiError(409, `${running} article(s) of this website are still in progress. Cancel them first.`);
  await prisma.website.delete({ where: { id: params.id } });
  if (website.profileId) {
    const others = await prisma.website.count({ where: { profileId: website.profileId } });
    if (others === 0) await enqueue('control', 'profile-delete', { profileId: website.profileId });
  }
  return { ok: true };
});
