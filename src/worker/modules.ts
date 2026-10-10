import type { QueueRunner } from './queue-runner';

/**
 * Hook for feature modules (WordPress profiles, workflows, humanizer test page) to register their control
 * handlers, queue runners and periodic ticks. Filled in by later milestones.
 */
export function registerWorkerModules(): void {}

export function extraRunners(): QueueRunner[] {
  return [];
}

export function extraTicks(): { name: string; ms: number; fn: () => Promise<void> }[] {
  return [];
}
