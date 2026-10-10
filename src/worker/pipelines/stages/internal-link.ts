import type { PipelineContext } from '../../engine/types';

export type ResolvedLink = { url: string; title: string };

/** Filled in with the internal-link rules (previous article of the same website). */
export async function resolveInternalLink(_ctx: PipelineContext): Promise<ResolvedLink | null> {
  return null;
}
