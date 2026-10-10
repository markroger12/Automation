import { readJson, route } from '@/server/api';
import { addKeywords } from '@/server/workflow-service';
import { addKeywordsSchema } from '@/lib/workflow-schema';

export const POST = route<{ websiteId: string }>(async ({ req, params }) => {
  const input = await readJson(req, addKeywordsSchema);
  return addKeywords(params.websiteId, input);
});
