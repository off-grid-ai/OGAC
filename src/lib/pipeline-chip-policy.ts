// ─── Pipeline-chip binding rules — PURE, zero-IO ────────────────────────────────────────────────────
//
// A consumer (app, runtime agent, chat project) names the pipeline that governs it. Turning a stored
// `pipelineId` into what the operator sees is a DECISION with three honest outcomes, not a render
// detail — so it lives here, unit-testable, with no database in sight.
//
// The third outcome is the one this module exists for. A stored id whose pipeline row is absent from
// this org (seed drift, a deleted pipeline, an id copied between deployments) used to be indistinct
// from a healthy binding: the resolver fell back to `name ?? id`, so a dangling reference rendered as
// a confident "Runs on: pl_seed_org_bharat_cross-sell-advisor" chip that linked to a hard 404. The
// not-found fact was known at the seam and thrown away. Losing it is the defect; `missing` keeps it.

/** What a pipeline-id lookup found. `found: false` is a REAL answer, not an error to swallow. */
export type PipelineLookup = { found: false } | { found: true; name?: string | null };

export interface PipelineChipData {
  /** The RESOLVED pipeline governing this consumer (own binding, else org default). Null ⇒ ungoverned. */
  id: string | null;
  /** The resolved pipeline's display name (falls back to the id when a name isn't available). */
  name?: string | null;
  /** True when the consumer pins nothing itself and is inheriting the org-default chat pipeline. */
  inherited?: boolean;
  /**
   * True when `id` is bound but no such pipeline exists in this org. The consumer is NOT governed by
   * what it claims — the operator must be told, and the chip must not offer a link that 404s.
   */
  missing?: boolean;
}

/** App/runtime-agent bindings are explicit: blank/null stays unbound, never Chat-inherited. */
export function explicitConsumerPipelineId(pipelineId: string | null | undefined): string | null {
  return pipelineId?.trim() || null;
}

/**
 * The chip for one consumer, given its stored binding and what looking that binding up found.
 *
 * Unbound and missing are deliberately different states: "no pipeline" is a valid configuration an
 * operator chose, while "missing" is a broken reference they need to repair. Collapsing the two would
 * hide the breakage just as effectively as the old `?? id` fallback did.
 */
export function consumerChip(
  boundPipelineId: string | null | undefined,
  lookup: PipelineLookup,
): PipelineChipData {
  const id = explicitConsumerPipelineId(boundPipelineId);
  if (!id) return { id: null };
  if (!lookup.found) return { id, name: id, inherited: false, missing: true };
  return { id, name: lookup.name?.trim() || id, inherited: false };
}

/** A lookup from a name-by-id map — absent key means absent pipeline, which is the whole point. */
export function lookupIn(nameById: ReadonlyMap<string, string>, id: string): PipelineLookup {
  return nameById.has(id) ? { found: true, name: nameById.get(id) } : { found: false };
}

/** True when a consumer's binding is broken — used to gate saves and to badge existing rows. */
export function isDanglingBinding(chip: PipelineChipData): boolean {
  return chip.missing === true && chip.id !== null;
}
