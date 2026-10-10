import type { TaskStatus } from '@prisma/client';

/** Client-safe description of a stage (shown in the UI and used to create stage rows). */
export type StageDescriptor = {
  key: string;
  label: string;
  kind: 'chatgpt' | 'local' | 'gate' | 'wordpress';
  status: TaskStatus;
  progress: number;
  description?: string;
};

export type PromptVariable = { name: string; description: string };

export type PromptDefinition = {
  key: string;
  name: string;
  description: string;
  defaultContent: string;
  variables: PromptVariable[];
};

export type ModuleManifest = {
  key: string;
  name: string;
  shortName?: string;
  description: string;
  icon: string;
  href: string;
  status: 'active' | 'coming-soon';
  group: 'Writers' | 'SEO Tools';
  /** Articles about a person (Quick Bio, celebrity images) */
  kind?: 'celebrity' | 'tigram';
  stages: StageDescriptor[];
  prompts: PromptDefinition[];
  /** Fields shown on the writer form */
  form?: { exampleTitle: boolean; secondaryKeywords: boolean };
  /** Maximum words used by the SEO check */
  maxWords?: number;
};
