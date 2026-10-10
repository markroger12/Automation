import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { prisma } from '@/server/db';
import { templateSetSchema } from '@/lib/design-schema';

export const dynamic = 'force-dynamic';

const select = { id: true, name: true, celebrityImages: true, tigramImages: true, logoFile: true, accentColour: true, logoPosition: true, featuredStyle: true, imageTemplate: true } as const;

export const GET = route<{ websiteId: string }>(async ({ params }) => {
  const website = await prisma.website.findUnique({ where: { id: params.websiteId }, select });
  if (!website) throw new ApiError(404, 'Website not found.');
  return { website };
});

const schema = z.object({
  celebrityImages: z.boolean().optional(),
  tigramImages: z.boolean().optional(),
  accentColour: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional().nullable(),
  logoPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center']).optional(),
  featuredStyle: z.enum(['split', 'single']).optional(),
  imageTemplate: templateSetSchema.nullable().optional(),
});

export const PUT = route<{ websiteId: string }>(async ({ req, params }) => {
  const body = await readJson(req, schema);
  const website = await prisma.website.update({
    where: { id: params.websiteId },
    data: {
      celebrityImages: body.celebrityImages,
      tigramImages: body.tigramImages,
      accentColour: body.accentColour === undefined ? undefined : body.accentColour || null,
      logoPosition: body.logoPosition,
      featuredStyle: body.featuredStyle,
      imageTemplate: body.imageTemplate === undefined ? undefined : body.imageTemplate && (body.imageTemplate.featured || body.imageTemplate.body) ? JSON.stringify(body.imageTemplate) : null,
    },
    select,
  });
  return { website };
});
