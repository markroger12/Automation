import { z } from 'zod';

export const taskInputSchema = z.object({
  moduleKey: z.string().min(1).max(60),
  keyword: z.string().trim().min(2).max(200),
  exampleTitle: z.string().trim().max(300).optional().nullable(),
  secondaryKeywords: z.array(z.string().trim().max(120)).max(30).default([]),
  targetCountry: z.string().trim().max(80).optional().nullable(),
  language: z.enum(['English', 'German']).optional().nullable(),
  websiteId: z.string().max(60).optional().nullable(),
  categoryId: z.string().max(60).optional().nullable(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const createTasksSchema = z.object({ tasks: z.array(taskInputSchema).min(1).max(1000) });

/** "keyword | secondary1, secondary2 | example title" — one article per line. */
export function parseKeywordLines(text: string): { keyword: string; secondaryKeywords: string[]; exampleTitle?: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((line) => {
      const [kw, sec, title] = line.split('|').map((s) => s.trim());
      return {
        keyword: kw ?? '',
        secondaryKeywords: (sec ?? '')
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        ...(title ? { exampleTitle: title } : {}),
      };
    })
    .filter((r) => r.keyword.length >= 2);
}
