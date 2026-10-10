import { z } from 'zod';

const num = z.number().finite();
const base = {
  id: z.string().max(60),
  x: num.min(-5000).max(7000),
  y: num.min(-5000).max(7000),
  w: num.min(1).max(8000),
  h: num.min(1).max(8000),
  rotation: num.min(-360).max(360).optional(),
  opacity: num.min(0).max(1).optional(),
  name: z.string().max(80).optional(),
  shadow: z.object({ x: num, y: num, blur: num.min(0).max(500), color: z.string().max(60) }).nullable().optional(),
};
const color = z.string().max(60).regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]+)$/);
/** Only data: and https: sources for fixed pictures (checked in the browser and again here). */
const src = z.string().max(6_000_000).refine((s) => /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(s) || /^https:\/\//i.test(s), 'Only data: and https: pictures are allowed');

const layer = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('picture'), slot: z.number().int().min(1).max(10), radius: num.min(0).optional(), borderWidth: num.min(0).max(100).optional(), borderColor: color.optional() }),
  z.object({ ...base, type: z.literal('logo'), plate: z.boolean(), plateColor: color.optional(), plateRadius: num.min(0).optional(), padding: num.min(0).max(400).optional() }),
  z.object({ ...base, type: z.literal('box'), shape: z.enum(['rect', 'circle']), fill: color, stroke: color.optional(), strokeWidth: num.min(0).max(200).optional(), radius: num.min(0).optional() }),
  z.object({
    ...base,
    type: z.literal('text'),
    text: z.string().max(2000),
    fontSize: num.min(4).max(1000),
    fontFamily: z.string().max(120).regex(/^[\w\s,'"-]+$/),
    fontWeight: z.number().int().min(100).max(1000),
    color,
    align: z.enum(['left', 'center', 'right']),
    lineHeight: num.min(0.5).max(5).optional(),
    italic: z.boolean().optional(),
    uppercase: z.boolean().optional(),
    letterSpacing: num.min(-50).max(200).optional(),
    background: color.optional(),
  }),
  z.object({ ...base, type: z.literal('image'), src, fit: z.enum(['cover', 'contain']).optional(), radius: num.min(0).optional() }),
]);

export const designSchema = z.object({ version: z.literal(1), width: z.literal(1920), height: z.literal(1080), background: color, layers: z.array(layer).max(80) });
export const templateSetSchema = z.object({ featured: designSchema.nullable().optional(), body: designSchema.nullable().optional() });
