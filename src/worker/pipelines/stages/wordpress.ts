import type { PipelineStage } from '../../engine/types';

export function wordpressDraftStage(): PipelineStage {
  return {
    key: 'WORDPRESS_DRAFT',
    label: 'WordPress draft',
    kind: 'wordpress',
    status: 'CREATING_DRAFT',
    progress: 94,
    async run() {
      return { outcome: 'completed', skipped: true, message: 'WordPress drafts are not set up yet.' };
    },
  };
}

export function rankMathStage(): PipelineStage {
  return {
    key: 'RANKMATH',
    label: 'Rank Math',
    kind: 'wordpress',
    status: 'RUNNING_RANKMATH',
    progress: 100,
    async run() {
      return { outcome: 'completed', skipped: true };
    },
  };
}
