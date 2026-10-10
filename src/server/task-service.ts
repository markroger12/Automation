import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { getSettings } from './settings';
import { ApiError } from './api';
import { createArticleTask } from './tasks';
import { getModule } from '@/modules/registry';
import type { TaskInput } from '@/lib/task-input';

/** Fills language/country/category defaults from the website and Settings, then creates the task. */
export async function createTaskFromInput(input: TaskInput, userId: string | null) {
  const mod = getModule(input.moduleKey);
  if (!mod || mod.status !== 'active' || mod.group !== 'Writers') throw new ApiError(400, 'Unknown writer.');
  const settings = await getSettings();
  const website = input.websiteId ? await prisma.website.findUnique({ where: { id: input.websiteId } }) : null;
  if (input.websiteId && !website) throw new ApiError(400, 'Website not found.');
  // Tigram articles without a chosen category let ChatGPT pick one of the website's categories.
  let categoryId = input.categoryId || (mod.kind === 'tigram' ? null : website?.defaultCategoryId) || null;
  if (categoryId && website) {
    const cat = await prisma.category.findFirst({ where: { id: categoryId, websiteId: website.id } });
    if (!cat) categoryId = null;
  }
  const language = input.language ?? (website?.language as 'English' | 'German' | undefined) ?? settings.defaultLanguage;
  const country = input.targetCountry || website?.targetCountry || (language === 'German' ? 'Germany' : settings.targetCountry);
  return createArticleTask({
    moduleKey: mod.key,
    keyword: input.keyword,
    exampleTitle: mod.form?.exampleTitle === false ? null : input.exampleTitle,
    secondaryKeywords: mod.form?.secondaryKeywords === false ? [] : input.secondaryKeywords,
    targetCountry: country,
    language,
    websiteId: website?.id ?? null,
    categoryId,
    createdById: userId,
  });
}

export const taskListSelect = {
  id: true,
  moduleKey: true,
  keyword: true,
  status: true,
  progress: true,
  statusMessage: true,
  currentStage: true,
  selectedTitle: true,
  seoScore: true,
  rankMathScore: true,
  wordCount: true,
  wpEditUrl: true,
  wpPostId: true,
  error: true,
  language: true,
  categoryName: true,
  createdAt: true,
  updatedAt: true,
  website: { select: { id: true, name: true } },
  workflowKeyword: { select: { id: true, publishAt: true, state: true } },
} satisfies Prisma.ArticleTaskSelect;
