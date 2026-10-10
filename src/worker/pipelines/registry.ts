import type { PipelineDefinition } from '../engine/types';
import { celebrityPipeline } from './celebrity-1';
import { tigramPipeline } from './tigram';

const pipelines = new Map<string, PipelineDefinition>();

export function registerPipeline(p: PipelineDefinition): void {
  pipelines.set(p.moduleKey, p);
}

export function getPipeline(moduleKey: string): PipelineDefinition | undefined {
  return pipelines.get(moduleKey);
}

registerPipeline(celebrityPipeline);
registerPipeline(tigramPipeline);
