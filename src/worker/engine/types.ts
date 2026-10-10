import type { ArticleStage, ArticleTask, Category, Prisma, TaskStatus, Website } from '@prisma/client';
import type { Settings } from '@/lib/settings-schema';
import type { Lang } from '@/core/language';
import type { ChatAttachment, ChatImageFile, ChatImageLink } from '@/server/chatgpt-jobs';

export type TaskWithRelations = ArticleTask & {
  website: (Website & { categories: Category[] }) | null;
  category: Category | null;
};

export type StageOutcome =
  | {
      outcome: 'completed';
      prompt?: string | null;
      output?: string | null;
      outputHtml?: string | null;
      data?: Record<string, unknown> | null;
      /** Reasons to finish as NEEDS_REVIEW (replaced when the stage runs again) */
      reviewReasons?: string[];
      skipped?: boolean;
      message?: string;
    }
  | { outcome: 'paused'; status: TaskStatus; message: string };

export type AskOptions = {
  /** Expect generated pictures (Tigram images) */
  images?: boolean;
  imageCount?: number;
  /** Expect an image-search gallery (celebrity images) */
  gallery?: boolean;
  attachments?: ChatAttachment[];
  /** Never recover an earlier answer */
  fresh?: boolean;
  /** Start a new chat (it becomes the article's chat) */
  newChat?: boolean;
  /** Do not append the language line */
  noLanguageLine?: boolean;
  label?: string;
};

export type ChatAnswer = {
  prompt: string;
  /** Answer as Markdown (page HTML is converted) */
  markdown: string;
  /** Sanitized HTML of the answer */
  html: string;
  conversationUrl: string | null;
  reusedExisting: boolean;
  imageFiles: ChatImageFile[];
  imageLinks: ChatImageLink[];
  durationMs: number;
};

export type StageLogger = {
  debug: (m: string, data?: unknown) => Promise<void>;
  info: (m: string, data?: unknown) => Promise<void>;
  warn: (m: string, data?: unknown) => Promise<void>;
  error: (m: string, data?: unknown) => Promise<void>;
};

export interface PipelineContext {
  task: TaskWithRelations;
  settings: Settings;
  mode: 'run' | 'regenerate';
  language: Lang;
  kind: 'celebrity' | 'tigram';
  pipeline: PipelineDefinition;
  jobId: string;
  stageKey: string;
  attempt: number;
  log: StageLogger;
  refresh(): Promise<TaskWithRelations>;
  update(data: Prisma.ArticleTaskUpdateInput): Promise<TaskWithRelations>;
  setMessage(message: string): Promise<void>;
  checkCancelled(): Promise<void>;
  stageRow(key: string): Promise<ArticleStage | null>;
  stageOutput(key: string): Promise<string | null>;
  stageData<T = Record<string, unknown>>(key: string): Promise<T | null>;
  /** Saves partial state of the running stage (survives a crash) */
  saveProgress(data: Record<string, unknown>): Promise<void>;
  askChatGPT(stageKey: string, promptKey: string, extra?: Record<string, unknown>, opts?: AskOptions): Promise<ChatAnswer>;
  /** Sends an already rendered prompt (still in the article's chat) */
  sendPrompt(stageKey: string, prompt: string, opts?: AskOptions): Promise<ChatAnswer>;
  variables(extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Images on/off for this task (website toggle, workflow override, Settings) */
  imagesEnabled(): boolean;
  maxWords(): number;
}

export interface PipelineStage {
  key: string;
  label: string;
  kind: 'chatgpt' | 'local' | 'gate' | 'wordpress';
  status: TaskStatus;
  progress: number;
  run(ctx: PipelineContext): Promise<StageOutcome>;
}

export interface PipelineDefinition {
  moduleKey: string;
  kind: 'celebrity' | 'tigram';
  stages: PipelineStage[];
  maxWords(settings: Settings): number;
  /** Stage keys to reset when `stageKey` is regenerated */
  regenerationPlan(stageKey: string, task: ArticleTask): string[];
  variables(ctx: PipelineContext, extra: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Text that restores the article context in a new chat (after the saved chat was lost) */
  contextPrimer?(ctx: PipelineContext, stageKey: string): Promise<string | null>;
  finalize(ctx: PipelineContext): Promise<void>;
  afterRegeneration?(ctx: PipelineContext, stageKey: string): Promise<void>;
}
