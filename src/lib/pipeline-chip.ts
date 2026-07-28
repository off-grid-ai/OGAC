// ─── Resolve a consumer's PipelineChip data (I/O adapter over the pure binding rules) ───────────────
//
// App and runtime-agent surfaces know their OWN explicit pipelineId. Null means deliberately unbound;
// the org Chat default is a Chat-only rule and must never appear on an App chip.
//
// This file only reads pipeline names and composes the view — every DECISION lives in the pure
// `pipeline-chip-policy`. Honest on both edges: nothing bound returns an unbound chip, and a bound id
// with no matching row returns a `missing` chip rather than a plausible-looking healthy one.

import {
  type PipelineChipData,
  type PipelineLookup,
  consumerChip,
  explicitConsumerPipelineId,
  lookupIn,
} from '@/lib/pipeline-chip-policy';
import { getPipeline, listPipelines } from '@/lib/pipelines';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

export { explicitConsumerPipelineId };
export type { PipelineChipData };

/**
 * Resolve the chip for a single App/agent consumer. Null is deliberately unbound.
 *
 * A read FAILURE and a genuine absence are both reported as `found: false`. That is deliberate: we
 * cannot claim a consumer is governed by a pipeline we could not confirm exists, and the degraded
 * chip says exactly that instead of asserting a binding we have not verified.
 */
export async function resolveConsumerChip(
  boundPipelineId: string | null | undefined,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineChipData> {
  const resolved = explicitConsumerPipelineId(boundPipelineId);
  if (!resolved) return { id: null };
  const p = await getPipeline(resolved, orgId).catch(() => null);
  const lookup: PipelineLookup = p ? { found: true, name: p.name } : { found: false };
  return consumerChip(resolved, lookup);
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
    return consumerChip(resolved, lookupIn(nameById, resolved));
  });
}
