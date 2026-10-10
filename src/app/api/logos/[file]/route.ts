import fs from 'node:fs/promises';
import { ApiError, route } from '@/server/api';
import { LOGOS_DIR, safeJoin } from '@/server/env';

export const GET = route<{ file: string }>(async ({ params }) => {
  if (!/^[\w-]+\.png$/.test(params.file)) throw new ApiError(400, 'Bad file name.');
  const file = safeJoin(LOGOS_DIR, params.file);
  if (!file) throw new ApiError(400, 'Bad file name.');
  try {
    return new Response(new Uint8Array(await fs.readFile(file)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
  } catch {
    throw new ApiError(404, 'Logo not found.');
  }
});
