import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ApiError, route } from '@/server/api';
import { prisma } from '@/server/db';
import { LOGOS_DIR, ensureDir, safeJoin } from '@/server/env';

/** Logo upload (PNG with transparency recommended). Stored as PNG ≤ 1000 px in data/logos. */
export const POST = route<{ websiteId: string }>(async ({ req, params }) => {
  const website = await prisma.website.findUnique({ where: { id: params.websiteId } });
  if (!website) throw new ApiError(404, 'Website not found.');
  const form = await req.formData();
  const file = form.get('logo');
  if (!(file instanceof File)) throw new ApiError(400, 'Choose a logo file.');
  if (file.size > 5 * 1024 * 1024) throw new ApiError(400, 'The logo must be smaller than 5 MB.');
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer())).resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new ApiError(400, 'This file is not a picture.');
  }
  const name = `${website.id}-${Date.now()}.png`;
  await fs.writeFile(path.join(ensureDir(LOGOS_DIR), name), png);
  if (website.logoFile) {
    const old = safeJoin(LOGOS_DIR, website.logoFile);
    if (old) await fs.rm(old, { force: true }).catch(() => undefined);
  }
  await prisma.website.update({ where: { id: website.id }, data: { logoFile: name } });
  return { logoFile: name };
});

export const DELETE = route<{ websiteId: string }>(async ({ params }) => {
  const website = await prisma.website.findUnique({ where: { id: params.websiteId } });
  if (!website) throw new ApiError(404, 'Website not found.');
  if (website.logoFile) {
    const old = safeJoin(LOGOS_DIR, website.logoFile);
    if (old) await fs.rm(old, { force: true }).catch(() => undefined);
  }
  await prisma.website.update({ where: { id: website.id }, data: { logoFile: null } });
  return { ok: true };
});
