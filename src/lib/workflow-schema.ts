import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');

/** Workflow settings plus the website fields the Workflow page edits. */
export const workflowSettingsSchema = z
  .object({
    isActive: z.boolean(),
    publishTimes: z
      .array(hhmm)
      .max(48)
      .transform((a) => [...new Set(a)].sort()),
    days: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((a) => [...new Set(a)].sort()),
    writeAheadHours: z.number().int().min(0).max(168),
    images: z.enum(['on', 'off']).nullable(),
    indexAfterPublish: z.boolean(),
    canPublish: z.boolean(),
    searchConsoleProperty: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .refine((v) => !v || /^https?:\/\//.test(v) || /^sc-domain:[a-z0-9.-]+$/i.test(v), 'Use https://site/ or sc-domain:site'),
    siteTimezone: z.string().trim().max(60).nullable(),
  })
  .partial();

export type WorkflowSettingsInput = z.infer<typeof workflowSettingsSchema>;

const kind = z.enum(['CELEBRITY', 'TIGRAM']);

export const addKeywordsSchema = z
  .object({
    text: z.string().max(200_000).optional(),
    csv: z.string().max(2_000_000).optional(),
    kind: kind.optional(),
  })
  .refine((v) => v.text || v.csv, 'Paste keywords or choose a CSV file.');

export const patchKeywordSchema = z.object({
  kind: kind.optional(),
  state: z.enum(['WAITING', 'SKIPPED']).optional(),
  title: z.string().trim().max(300).nullable().optional(),
  move: z.enum(['up', 'down', 'top']).optional(),
});

export const MAX_KEYWORDS_PER_ADD = 500;
