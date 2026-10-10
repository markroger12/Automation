import type { QueueRunner } from './queue-runner';
import { closeIdleProfiles } from './browser/profiles';
import './wordpress/control-handlers';

/**
 * Hook for feature modules (WordPress profiles, workflows, humanizer test page) to register their control
 * handlers, queue runners and periodic ticks.
 */
export function registerWorkerModules(): void {}

export function extraRunners(): QueueRunner[] {
  return [];
}

export function extraTicks(): { name: string; ms: number; fn: () => Promise<void> }[] {
  return [{ name: 'close-idle-profiles', ms: 30_000, fn: closeIdleProfiles }];
}
