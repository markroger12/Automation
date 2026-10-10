import { z } from 'zod';

export function normaliseUrl(input: string): string {
  let v = input.trim();
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  const u = new URL(v);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

const urlField = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .transform((v, ctx) => {
    try {
      return normaliseUrl(v);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a valid address' });
      return z.NEVER;
    }
  });

export const websiteInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: urlField,
  adminUrl: z.union([urlField, z.literal('')]).optional(),
  editorType: z.enum(['AUTO', 'GUTENBERG', 'CLASSIC']).default('AUTO'),
  language: z.enum(['English', 'German']).default('English'),
  targetCountry: z.string().trim().max(80).optional().nullable(),
  isActive: z.boolean().default(true),
  celebrityImages: z.boolean().default(true),
  tigramImages: z.boolean().default(true),
  internalLinkText: z.string().trim().max(120).default('Also read:'),
  defaultCategoryId: z.string().optional().nullable(),
  searchConsoleProperty: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .refine((v) => !v || /^https?:\/\//.test(v) || /^sc-domain:[a-z0-9.-]+$/i.test(v), 'Use https://site/ or sc-domain:site'),
  siteTimezone: z.string().trim().max(60).optional().nullable(),
  canPublish: z.boolean().optional(),
});

export type WebsiteInput = z.infer<typeof websiteInputSchema>;

export function defaultAdminUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/wp-admin`;
}
