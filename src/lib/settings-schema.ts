import { z } from 'zod';

/**
 * One settings schema shared by the dashboard and the worker.
 * Every field has a default so an empty database yields a complete, valid object.
 */
export const settingsSchema = z.object({
  // Browser
  browserMode: z.enum(['headless', 'background', 'visible']).default('headless'),
  browserTimeoutSec: z.coerce.number().int().min(10).max(600).default(60),
  generationTimeoutSec: z.coerce.number().int().min(60).max(900).default(600),
  captureScreenshots: z.boolean().default(true),
  chatgptUrl: z.string().url().default('https://chatgpt.com/'),
  chatgptChromeMode: z.enum(['separate', 'profile']).default('separate'),

  // Workflow
  manualTitleApproval: z.boolean().default(false),
  manualArticleApproval: z.boolean().default(false),
  autoSendToWordPress: z.boolean().default(true),
  createMissingCategory: z.boolean().default(false),
  taskConcurrency: z.coerce.number().int().min(1).max(5).default(1),
  retryAttempts: z.coerce.number().int().min(0).max(5).default(2),
  workflowCelebrityWriter: z.enum(['1.0', '2.0']).default('1.0'),

  // Content
  maxArticleWordCount: z.coerce.number().int().min(300).max(5000).default(1300),
  minKeywordOccurrences: z.coerce.number().int().min(0).max(100).default(15),
  maxKeywordOccurrences: z.coerce.number().int().min(1).max(150).default(18),
  faqCount: z.coerce.number().int().min(1).max(15).default(5),
  quickBioRows: z.coerce.number().int().min(4).max(30).default(12),
  defaultLanguage: z.enum(['English', 'German']).default('English'),
  targetCountry: z.string().min(1).max(80).default('United States'),

  // SEO
  seoReviewThreshold: z.coerce.number().int().min(0).max(100).default(70),
  rankMathTargetScore: z.coerce.number().int().min(0).max(100).default(75),
  maxRankMathAttempts: z.coerce.number().int().min(0).max(10).default(3),
  externalLinks: z.boolean().default(true),
  maxExternalLinks: z.coerce.number().int().min(0).max(15).default(5),
  articleImages: z.boolean().default(true),
  enhanceCelebrityImages: z.boolean().default(true),
  celebrityPhotoReview: z.boolean().default(true),

  // Advanced
  selectorOverrides: z.string().default('{}'),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Validates the selector override JSON: { "group.element": ["selector", ...] }. */
export const selectorOverridesSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

export function parseSelectorOverrides(raw: string): Record<string, string[]> {
  try {
    const parsed = selectorOverridesSchema.parse(JSON.parse(raw || '{}'));
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = Array.isArray(v) ? v : [v];
    return out;
  } catch {
    return {};
  }
}

export type SettingField = {
  key: SettingKey;
  label: string;
  help?: string;
  type: 'boolean' | 'number' | 'text' | 'select' | 'json';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
};

export const SETTINGS_GROUPS: { title: string; fields: SettingField[] }[] = [
  {
    title: 'Browser',
    fields: [
      {
        key: 'browserMode',
        label: 'WordPress browser mode',
        type: 'select',
        options: [
          { value: 'headless', label: 'Headless (no window)' },
          { value: 'background', label: 'Background (off-screen window)' },
          { value: 'visible', label: 'Visible' },
        ],
        help: 'Login windows are always visible.',
      },
      { key: 'browserTimeoutSec', label: 'Page timeout (seconds)', type: 'number', min: 10, max: 600 },
      {
        key: 'generationTimeoutSec',
        label: 'ChatGPT answer timeout (seconds)',
        type: 'number',
        min: 60,
        max: 900,
        help: 'Time spent waiting on ChatGPT rate limits does not count.',
      },
      { key: 'captureScreenshots', label: 'Save screenshots when a step fails', type: 'boolean' },
      { key: 'chatgptUrl', label: 'ChatGPT address', type: 'text' },
      {
        key: 'chatgptChromeMode',
        label: 'Automation Chrome',
        type: 'select',
        options: [
          { value: 'separate', label: 'Separate Chrome (data/chatgpt-chrome)' },
          { value: 'profile', label: 'My usual Chrome profile' },
        ],
      },
    ],
  },
  {
    title: 'Workflow',
    fields: [
      { key: 'manualTitleApproval', label: 'Manual title approval', type: 'boolean' },
      { key: 'manualArticleApproval', label: 'Manual article approval', type: 'boolean' },
      { key: 'autoSendToWordPress', label: 'Send finished articles to WordPress automatically', type: 'boolean' },
      { key: 'createMissingCategory', label: 'Create a missing category in WordPress', type: 'boolean' },
      {
        key: 'taskConcurrency',
        label: 'Task concurrency',
        type: 'number',
        min: 1,
        max: 5,
        help: 'Articles written at the same time. Also the number of ChatGPT tabs. 2–3 works best.',
      },
      { key: 'retryAttempts', label: 'Retries per stage', type: 'number', min: 0, max: 5 },
      {
        key: 'workflowCelebrityWriter',
        label: 'Writer used by Workflows for celebrity keywords',
        type: 'select',
        options: [
          { value: '1.0', label: 'Celebrity Article Writer 1.0' },
          { value: '2.0', label: 'Celebrity Writer 2.0' },
        ],
      },
    ],
  },
  {
    title: 'Content',
    fields: [
      { key: 'maxArticleWordCount', label: 'Maximum words', type: 'number', min: 300, max: 5000 },
      { key: 'minKeywordOccurrences', label: 'Keyword uses (minimum)', type: 'number', min: 0, max: 100 },
      { key: 'maxKeywordOccurrences', label: 'Keyword uses (maximum)', type: 'number', min: 1, max: 150 },
      { key: 'faqCount', label: 'Number of FAQs', type: 'number', min: 1, max: 15 },
      { key: 'quickBioRows', label: 'Quick Bio rows', type: 'number', min: 4, max: 30 },
      {
        key: 'defaultLanguage',
        label: 'Default language',
        type: 'select',
        options: [
          { value: 'English', label: 'English' },
          { value: 'German', label: 'German' },
        ],
      },
      { key: 'targetCountry', label: 'Default target country', type: 'text' },
    ],
  },
  {
    title: 'SEO',
    fields: [
      { key: 'seoReviewThreshold', label: 'Review below this SEO Readiness Score', type: 'number', min: 0, max: 100 },
      { key: 'rankMathTargetScore', label: 'Rank Math target score', type: 'number', min: 0, max: 100 },
      { key: 'maxRankMathAttempts', label: 'Rank Math fix rounds', type: 'number', min: 0, max: 10 },
      { key: 'externalLinks', label: 'Add verified external links', type: 'boolean' },
      { key: 'maxExternalLinks', label: 'Maximum external links', type: 'number', min: 0, max: 15 },
      { key: 'articleImages', label: 'Create article images', type: 'boolean' },
      {
        key: 'enhanceCelebrityImages',
        label: 'Enhance soft or small celebrity pictures (Upscayl)',
        type: 'boolean',
      },
      { key: 'celebrityPhotoReview', label: 'Photo check (watermarks, collages, alt text)', type: 'boolean' },
    ],
  },
  {
    title: 'Advanced',
    fields: [
      {
        key: 'selectorOverrides',
        label: 'Selector overrides (JSON)',
        type: 'json',
        help: 'Example: {"rankmath.score": [".my-score"]}. Your selectors are tried first.',
      },
    ],
  },
];
