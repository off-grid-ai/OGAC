// ─── Resolve a consumer's PipelineChip data (I/O adapter over the pure binding rules) ───────────────
//
// App and runtime-agent surfaces know their OWN explicit pipelineId. Null means deliberately unbound;
// the org Chat default is a Chat-only rule and must never appear on an App chip.
//
// This file only reads pipeline names and composes the view. Honest: when nothing is explicitly bound
// it returns an unbound chip, never a fake inherited contract.

import type { PipelineChipData } from '@/components/pipelines/PipelineChip';
import { getPipeline, listPipelines } from '@/lib/pipelines';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

/** App/runtime-agent bindings are explicit: blank/null stays unbound, never Chat-inherited. */
export function explicitConsumerPipelineId(pipelineId: string | null | undefined): string | null {
  return pipelineId?.trim() || null;
}

/**
 * Resolve the chip for a single App/agent consumer. Null is deliberately unbound.
 */
export async function resolveConsumerChip(
  boundPipelineId: string | null | undefined,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineChipData> {
  const resolved = explicitConsumerPipelineId(boundPipelineId);
  if (!resolved) return { id: null };
  const p = await getPipeline(resolved, orgId).catch(() => null);
  return { id: resolved, name: p?.name ?? resolved, inherited: false };
}

/**
 * Batch variant for a LIST surface (e.g. studio app cards): resolve many consumers' chips in ONE pass —
 * reads the org governance + the full pipeline name map once, then maps each bound id purely. Returns a
 * chip keyed to each input id (same order). Far cheaper than N × resolveConsumerChip for a grid.
 */
export async function resolveConsumerChips(
  boundPipelineIds: (string | null | undefined)[],
  orgId: string = DEFAULT_ORG,
): Promise<PipelineChipData[]> {
  const pipelines = await listPipelines(orgId).catch(() => []);
  const nameById = new Map(pipelines.map((p) => [p.id, p.name]));
  return boundPipelineIds.map((bound) => {
    const resolved = explicitConsumerPipelineId(bound);
    if (!resolved) return { id: null };
    return { id: resolved, name: nameById.get(resolved) ?? resolved, inherited: false };
  });
}
