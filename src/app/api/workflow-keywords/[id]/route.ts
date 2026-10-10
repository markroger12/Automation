import { readJson, route } from '@/server/api';
import { deleteKeyword, patchKeyword } from '@/server/workflow-service';
import { patchKeywordSchema } from '@/lib/workflow-schema';

export const PATCH = route<{ id: string }>(async ({ req, params }) => {
  const input = await readJson(req, patchKeywordSchema);
  return { keyword: await patchKeyword(params.id, input) };
});

export const DELETE = route<{ id: string }>(async ({ params }) => {
  await deleteKeyword(params.id);
  return { ok: true };
});
