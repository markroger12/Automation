import type { PipelineStage } from '../../engine/types';

export function celebrityImagesStage(progress = 68): PipelineStage {
  return {
    key: 'IMAGES',
    label: 'Images',
    kind: 'chatgpt',
    status: 'OPTIMIZING',
    progress,
    async run() {
      return { outcome: 'completed', skipped: true, message: 'Images are not set up yet.' };
    },
  };
}
