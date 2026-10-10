import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { writeLog } from '@/server/log';
import { getOrCreateWorkflow } from '@/server/workflow-service';
import { workflowSettingsSchema } from '@/lib/workflow-schema';

export const dynamic = 'force-dynamic';

export const PUT = route<{ websiteId: string }>(async ({ req, params, user }) => {
  const input = await readJson(req, workflowSettingsSchema);
  const wf = await getOrCreateWorkflow(params.websiteId);
  const website = await prisma.website.findUniqueOrThrow({ where: { id: params.websiteId } });
  const { canPublish, searchConsoleProperty, siteTimezone, publishTimes, days, ...rest } = input;

  if (canPublish !== undefined && canPublish !== website.canPublish) {
    if (user.role !== 'ADMIN') throw new ApiError(403, 'Only an admin can change whether a website may publish by itself.');
    await writeLog({ level: 'WARN', category: 'WORDPRESS', stage: 'WORKFLOW', message: `${user.email} ${canPublish ? 'allowed' : 'stopped'} ${website.name} ${canPublish ? 'to publish' : 'from publishing'} by itself.` });
  }
  if (rest.indexAfterPublish && !(searchConsoleProperty ?? website.searchConsoleProperty)) {
    throw new ApiError(400, 'Enter the Search Console property first (for example sc-domain:example.com).');
  }
  if (rest.isActive && !website.isActive) throw new ApiError(400, 'This website is switched off. Switch it on in Websites first.');

  await prisma.$transaction([
    prisma.workflow.update({
      where: { id: wf.id },
      data: {
        ...rest,
        ...(publishTimes ? { publishTimes: JSON.stringify(publishTimes) } : {}),
        ...(days ? { days: JSON.stringify(days.length === 7 ? [] : days) } : {}),
      },
    }),
    prisma.website.update({
      where: { id: website.id },
      data: {
        ...(canPublish !== undefined ? { canPublish } : {}),
        ...(searchConsoleProperty !== undefined ? { searchConsoleProperty: searchConsoleProperty || null } : {}),
        ...(siteTimezone !== undefined ? { siteTimezone: siteTimezone || null } : {}),
      },
    }),
  ]);
  // New publish times: waiting keywords take fresh slots on the next tick.
  if (publishTimes || days) await prisma.workflowKeyword.updateMany({ where: { workflowId: wf.id, state: 'WAITING' }, data: { publishAt: null } });
  if (rest.isActive !== undefined && rest.isActive !== wf.isActive) {
    await writeLog({ category: 'QUEUE', stage: 'WORKFLOW', message: `Workflow of ${website.name} switched ${rest.isActive ? 'on' : 'off'} by ${user.email}.` });
  }
  return { ok: true };
});
