import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { enqueue } from '@/server/queue';
import { templateSetSchema } from '@/lib/design-schema';

const schema = z.object({
  accentColour: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional().nullable(),
  logoPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center']),
  featuredStyle: z.enum(['split', 'single']),
  imageTemplate: templateSetSchema.nullable().optional(),
});

/** Live preview with the real renderer (the worker renders in headless Chrome). */
export const POST = route<{ websiteId: string }>(async ({ req, params }) => {
  const body = await readJson(req, schema);
  const website = await prisma.website.findUnique({ where: { id: params.websiteId } });
  if (!website) throw new ApiError(404, 'Website not found.');
  const job = await enqueue('control', 'render-preview', { websiteId: website.id, ...body });
  return { jobId: job.id };
});
