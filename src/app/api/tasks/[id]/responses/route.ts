import { route } from '@/server/api';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ params }) => ({
  responses: await prisma.chatGPTResponse.findMany({
    where: { taskId: params.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, stageKey: true, attempt: true, prompt: true, responseText: true, conversationUrl: true, reusedExisting: true, durationMs: true, createdAt: true },
  }),
}));
