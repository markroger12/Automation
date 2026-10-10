import { startQueueRunner, type QueueRunner } from './queue-runner';
import { handleHumanizerJob } from './humanizer/test-runner';
import { handleWorkflowJob } from './workflow/jobs';
import { handlePlagiarismJob } from './plagiarism/run';
import { workflowTick } from './workflow/scheduler';
import { closeIdleProfiles } from './browser/profiles';
import './wordpress/control-handlers';
import './images/preview';

/**
 * Hook for feature modules (WordPress profiles, workflows, humanizer test page, plagiarism check) to register their control
 * handlers, queue runners and periodic ticks.
 */
export function registerWorkerModules(): void {}

export function extraRunners(): QueueRunner[] {
  return [
    startQueueRunner({ queue: 'humanizer', concurrency: () => 1, handle: (job) => handleHumanizerJob(job), heartbeatMs: 10_000 }),
    startQueueRunner({ queue: 'workflow', concurrency: () => 1, handle: (job) => handleWorkflowJob(job), heartbeatMs: 10_000 }),
    startQueueRunner({ queue: 'plagiarism', concurrency: () => 1, handle: (job) => handlePlagiarismJob(job), heartbeatMs: 10_000 }),
  ];
}

export function extraTicks(): { name: string; ms: number; fn: () => Promise<void> }[] {
  return [
    { name: 'close-idle-profiles', ms: 30_000, fn: closeIdleProfiles },
    { name: 'workflow-scheduler', ms: 60_000, fn: () => workflowTick() },
  ];
}
