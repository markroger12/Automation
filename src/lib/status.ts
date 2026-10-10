import type { BadgeColor } from '@/components/ui';

export const TASK_STATUSES = [
  'QUEUED',
  'OPENING_CHATGPT',
  'GENERATING_TITLES',
  'AWAITING_TITLE_APPROVAL',
  'RESEARCHING',
  'WRITING_ARTICLE',
  'OPTIMIZING',
  'GENERATING_FAQS',
  'GENERATING_BIO_TABLE',
  'SEO_CHECKING',
  'AWAITING_ARTICLE_APPROVAL',
  'OPENING_WORDPRESS',
  'CREATING_DRAFT',
  'RUNNING_RANKMATH',
  'DRAFT_CREATED',
  'NEEDS_REVIEW',
  'LOGIN_REQUIRED',
  'FAILED',
  'CANCELLED',
] as const;
export type TaskStatusName = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatusName, string> = {
  QUEUED: 'Queued',
  OPENING_CHATGPT: 'Opening ChatGPT',
  GENERATING_TITLES: 'Generating titles',
  AWAITING_TITLE_APPROVAL: 'Awaiting title approval',
  RESEARCHING: 'Researching',
  WRITING_ARTICLE: 'Writing article',
  OPTIMIZING: 'Optimizing',
  GENERATING_FAQS: 'Generating FAQs',
  GENERATING_BIO_TABLE: 'Generating Quick Bio',
  SEO_CHECKING: 'SEO checking',
  AWAITING_ARTICLE_APPROVAL: 'Awaiting article approval',
  OPENING_WORDPRESS: 'Opening WordPress',
  CREATING_DRAFT: 'Creating draft',
  RUNNING_RANKMATH: 'Running Rank Math',
  DRAFT_CREATED: 'Draft created',
  NEEDS_REVIEW: 'Needs review',
  LOGIN_REQUIRED: 'Login required',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const FINISHED_STATUSES: TaskStatusName[] = ['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'];
export const WAITING_STATUSES: TaskStatusName[] = ['AWAITING_TITLE_APPROVAL', 'AWAITING_ARTICLE_APPROVAL', 'LOGIN_REQUIRED'];

export function isRunningStatus(s: string): boolean {
  return !FINISHED_STATUSES.includes(s as TaskStatusName) && !WAITING_STATUSES.includes(s as TaskStatusName) && s !== 'QUEUED';
}

export function isActiveStatus(s: string): boolean {
  return !FINISHED_STATUSES.includes(s as TaskStatusName);
}

export function statusColor(s: string): BadgeColor {
  switch (s) {
    case 'DRAFT_CREATED':
      return 'green';
    case 'NEEDS_REVIEW':
      return 'yellow';
    case 'FAILED':
      return 'red';
    case 'CANCELLED':
      return 'gray';
    case 'LOGIN_REQUIRED':
      return 'orange';
    case 'AWAITING_TITLE_APPROVAL':
    case 'AWAITING_ARTICLE_APPROVAL':
      return 'purple';
    case 'QUEUED':
      return 'gray';
    default:
      return 'blue';
  }
}

export const STAGE_STATUS_COLOR: Record<string, BadgeColor> = {
  PENDING: 'gray',
  RUNNING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  SKIPPED: 'gray',
};

export const KEYWORD_STATE_COLOR: Record<string, BadgeColor> = {
  WAITING: 'gray',
  WRITING: 'blue',
  READY: 'purple',
  SCHEDULED: 'yellow',
  PUBLISHED: 'green',
  INDEXED: 'green',
  FAILED: 'red',
  SKIPPED: 'gray',
  DONE: 'green',
};
