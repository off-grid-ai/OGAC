// ─── Resolve a consumer's PipelineChip data (I/O adapter over the pure binding rules) ───────────────
//
// The consumer surfaces (studio app cards, /apps/[id], /agents/[id], chat, project settings) each know
// their OWN bound pipelineId (apps.pipeline_id / chat_projects.pipeline_id) — or null, meaning inherit
// the org default. This adapter turns that into the presentational PipelineChipData the shared
// <PipelineChip> renders: the RESOLVED pipeline id + its display name + whether it was inherited.
//
// SOLID: the pure decision (own binding, else org default) is resolveConsumerPipeline in
// chat-pipeline-policy.ts; this file only does the reads (org governance + the pipeline's name) and
// composes the view. Honest: when nothing resolves it returns an "ungoverned" chip, never a fake one.

import type { PipelineChipData } from '@/components/pipelines/PipelineChip';
import { resolveConsumerPipeline } from '@/lib/chat-pipeline-policy';
import { getPipeline, listPipelines } from '@/lib/pipelines';
import { getChatBindingGovernance } from '@/lib/store';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

/**
 * Resolve the chip for a single consumer given its own bound pipeline id (or null to inherit). Reads
 * the org-default chat pipeline as the fallback, then the resolved pipeline's name. `inherited` is true
 * when the consumer pinned nothing and we fell back to the org default.
 */
export async function resolveConsumerChip(
  boundPipelineId: string | null | undefined,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineChipData> {
  const gov = await getChatBindingGovernance(orgId).catch(() => ({
    defaultChatPipelineId: null as string | null,
    allowlist: [] as string[],
  }));
  const resolved = resolveConsumerPipeline(boundPipelineId, gov.defaultChatPipelineId);
  if (!resolved) return { id: null };
  const inherited = !boundPipelineId; // pinned nothing ⇒ inheriting the org default
  const p = await getPipeline(resolved, orgId).catch(() => null);
  return { id: resolved, name: p?.name ?? resolved, inherited };
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
  const [gov, pipelines] = await Promise.all([
    getChatBindingGovernance(orgId).catch(() => ({
      defaultChatPipelineId: null as string | null,
      allowlist: [] as string[],
    })),
    listPipelines(orgId).catch(() => []),
  ]);
  const nameById = new Map(pipelines.map((p) => [p.id, p.name]));
  return boundPipelineIds.map((bound) => {
    const resolved = resolveConsumerPipeline(bound, gov.defaultChatPipelineId);
    if (!resolved) return { id: null };
    return { id: resolved, name: nameById.get(resolved) ?? resolved, inherited: !bound };
  });
}
