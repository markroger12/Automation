import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError, route } from '@/server/api';
import { MEDIA_DIR, safeJoin } from '@/server/env';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Article images in data/media (signed-in users only, path validated). */
export const GET = route<{ path: string[] }>(async ({ params }) => {
  const rel = (params.path ?? []).join('/');
  if (!rel || rel.includes('\0') || rel.split('/').some((p) => p === '..' || p.startsWith('.'))) throw new ApiError(400, 'Bad path.');
  const file = safeJoin(MEDIA_DIR, rel);
  const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
  if (!file || !type) throw new ApiError(400, 'Bad path.');
  try {
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    throw new ApiError(404, 'Image not found.');
  }
});
