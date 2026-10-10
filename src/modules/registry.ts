import type { ModuleManifest } from './types';
import { celebrityWriterManifest } from './celebrity-writer/manifest';
import { celebrityWriter2Manifest } from './celebrity-writer-2/manifest';
import { tigramWriterManifest } from './tigram-writer/manifest';
import { humanizerPrompt } from './shared-prompts';

/** Client-safe module registry. Server-side pipelines are registered separately (src/worker/pipelines). */

const humanizerTool: ModuleManifest = {
  key: 'ai-humanizer',
  name: 'AI Humanizer',
  description: 'Test page: rewrite any article or pasted text with the humanizer and compare paragraph by paragraph.',
  icon: 'Wand2',
  href: '/humanizer',
  status: 'active',
  group: 'SEO Tools',
  stages: [],
  prompts: [humanizerPrompt()],
};

const plagiarismTool: ModuleManifest = {
  key: 'plagiarism-check',
  name: 'Plagiarism Check',
  description: 'Shows overlapping passages side by side, with the sources they come from.',
  icon: 'ScanSearch',
  href: '/plagiarism',
  status: 'active',
  group: 'SEO Tools',
  stages: [],
  prompts: [],
};

const comingSoon = (key: string, name: string, icon: string, group: ModuleManifest['group'], description: string): ModuleManifest => ({
  key,
  name,
  description,
  icon,
  href: `/coming-soon/${key}`,
  status: 'coming-soon',
  group,
  stages: [],
  prompts: [],
});

export const MODULES: ModuleManifest[] = [
  celebrityWriterManifest,
  celebrityWriter2Manifest,
  tigramWriterManifest,
  comingSoon('product-review-writer', 'Product Review Writer', 'ShoppingBag', 'Writers', 'Product reviews with pros, cons and comparison tables.'),
  comingSoon('news-writer', 'News Writer', 'Newspaper', 'Writers', 'Short news articles from a headline and sources.'),
  humanizerTool,
  plagiarismTool,
  comingSoon('keyword-clustering', 'Keyword Clustering', 'Network', 'SEO Tools', 'Groups keywords into article topics.'),
  comingSoon('content-refresh', 'Content Refresh', 'RefreshCw', 'SEO Tools', 'Updates old posts with new facts.'),
];

export const WRITER_MODULES = MODULES.filter((m) => m.group === 'Writers' && m.status === 'active');

export function getModule(key: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.key === key);
}

export function moduleName(key: string): string {
  return getModule(key)?.shortName ?? getModule(key)?.name ?? key;
}
