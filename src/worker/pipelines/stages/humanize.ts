import type { PipelineStage } from '../../engine/types';

export function humanizeStage(progress = 76): PipelineStage {
  return {
    key: 'HUMANIZE',
    label: 'Humanize',
    kind: 'chatgpt',
    status: 'OPTIMIZING',
    progress,
    async run() {
      return { outcome: 'completed', skipped: true, message: 'Humanizer is not set up yet.' };
    },
  };
}
