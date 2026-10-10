import type { ModuleManifest, StageDescriptor } from '../types';
import { CELEBRITY_PROMPTS } from './prompts';

export const CELEBRITY_STAGES: StageDescriptor[] = [
  { key: 'TITLES', label: 'Titles', kind: 'chatgpt', status: 'GENERATING_TITLES', progress: 8, description: 'Title ideas and a recommended title' },
  { key: 'TITLE_APPROVAL', label: 'Title approval', kind: 'gate', status: 'AWAITING_TITLE_APPROVAL', progress: 10, description: 'Pauses when Manual Title Approval is on' },
  { key: 'RESEARCH', label: 'Research', kind: 'chatgpt', status: 'RESEARCHING', progress: 20, description: 'Biography research in the same chat' },
  { key: 'LONG_ARTICLE', label: 'Long article', kind: 'chatgpt', status: 'WRITING_ARTICLE', progress: 32, description: '1,500–2,000 words' },
  { key: 'FINAL_ARTICLE', label: 'Final article', kind: 'chatgpt', status: 'OPTIMIZING', progress: 42, description: 'Rewritten to the maximum word count' },
  { key: 'FAQS', label: 'FAQs', kind: 'chatgpt', status: 'GENERATING_FAQS', progress: 48 },
  { key: 'QUICK_BIO', label: 'Quick Bio', kind: 'chatgpt', status: 'GENERATING_BIO_TABLE', progress: 54 },
  { key: 'EXTERNAL_LINKS', label: 'External links', kind: 'chatgpt', status: 'OPTIMIZING', progress: 60, description: 'Suggested by ChatGPT, verified by the app' },
  { key: 'IMAGES', label: 'Images', kind: 'chatgpt', status: 'OPTIMIZING', progress: 68, description: 'Image search, photo check, templates' },
  { key: 'HUMANIZE', label: 'Humanize', kind: 'chatgpt', status: 'OPTIMIZING', progress: 76, description: 'Editorial rewrite with fact locks' },
  { key: 'ASSEMBLY', label: 'Assembly', kind: 'local', status: 'SEO_CHECKING', progress: 80, description: 'Builds the final HTML and SEO fields' },
  { key: 'SEO_CHECK', label: 'SEO check', kind: 'local', status: 'SEO_CHECKING', progress: 84 },
  { key: 'ARTICLE_APPROVAL', label: 'Article approval', kind: 'gate', status: 'AWAITING_ARTICLE_APPROVAL', progress: 85 },
  { key: 'WORDPRESS_DRAFT', label: 'WordPress draft', kind: 'wordpress', status: 'CREATING_DRAFT', progress: 94 },
  { key: 'RANKMATH', label: 'Rank Math', kind: 'wordpress', status: 'RUNNING_RANKMATH', progress: 100 },
];

export const celebrityWriterManifest: ModuleManifest = {
  key: 'celebrity-writer',
  name: 'Celebrity Article Writer 1.0',
  shortName: 'Celebrity Writer',
  description: 'Biography articles about a person: titles, research, article, FAQs, Quick Bio, images.',
  icon: 'UserRound',
  href: '/writers/celebrity-writer',
  status: 'active',
  group: 'Writers',
  kind: 'celebrity',
  stages: CELEBRITY_STAGES,
  prompts: CELEBRITY_PROMPTS,
  form: { exampleTitle: true, secondaryKeywords: true },
};
