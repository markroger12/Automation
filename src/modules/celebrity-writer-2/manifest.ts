import type { ModuleManifest, StageDescriptor } from '../types';
import { WRITER2_PROMPTS } from './prompts';

export const WRITER2_STAGES: StageDescriptor[] = [
  { key: 'ARTICLE', label: 'Article', kind: 'chatgpt', status: 'WRITING_ARTICLE', progress: 35, description: 'One answer: research and the full article' },
  { key: 'EXTERNAL_LINKS', label: 'External links', kind: 'chatgpt', status: 'OPTIMIZING', progress: 50 },
  { key: 'IMAGES', label: 'Images', kind: 'chatgpt', status: 'OPTIMIZING', progress: 62 },
  { key: 'HUMANIZE', label: 'Humanize', kind: 'chatgpt', status: 'OPTIMIZING', progress: 74 },
  { key: 'ASSEMBLY', label: 'Assembly', kind: 'local', status: 'SEO_CHECKING', progress: 80 },
  { key: 'SEO_CHECK', label: 'SEO check', kind: 'local', status: 'SEO_CHECKING', progress: 84 },
  { key: 'ARTICLE_APPROVAL', label: 'Article approval', kind: 'gate', status: 'AWAITING_ARTICLE_APPROVAL', progress: 85 },
  { key: 'WORDPRESS_DRAFT', label: 'WordPress draft', kind: 'wordpress', status: 'CREATING_DRAFT', progress: 94 },
  { key: 'RANKMATH', label: 'Rank Math', kind: 'wordpress', status: 'RUNNING_RANKMATH', progress: 100 },
];

export const celebrityWriter2Manifest: ModuleManifest = {
  key: 'celebrity-writer-2',
  name: 'Celebrity Writer 2.0',
  shortName: 'Celebrity Writer 2.0',
  description: "One ChatGPT answer writes the whole biography from the owner's research-and-writing prompt.",
  icon: 'Sparkles',
  href: '/writers/celebrity-writer-2',
  status: 'active',
  group: 'Writers',
  kind: 'celebrity',
  stages: WRITER2_STAGES,
  prompts: WRITER2_PROMPTS,
  form: { exampleTitle: false, secondaryKeywords: false },
  maxWords: 2000,
};
