import type { PipelineStage } from '../../engine/types';

export function externalLinksStage(progress = 60): PipelineStage {
  return {
    key: 'EXTERNAL_LINKS',
    label: 'External links',
    kind: 'chatgpt',
    status: 'OPTIMIZING',
    progress,
    async run() {
      return { outcome: 'completed', skipped: true, message: 'External links are not set up yet.' };
    },
  };
}
