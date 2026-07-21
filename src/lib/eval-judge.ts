// ─── PURE eval-judge routing resolution (governing invariant) ────────────────────────────────────
//
// THE INVARIANT (docs/ENGINEERING.md): agent/app → pipeline → gateway → model. Nothing references a
// model or gateway directly. The eval/QA "LLM judge" is an internal AI-using service, so it MUST be
// fronted by a system agent bound to a pipeline; its model resolves through pipeline→gateway, never
// an env-pinned model id. This module is the pure resolver: given the judge agent + its pipeline +
// that pipeline's gateway (loaded by the I/O caller), decide the model to use and whether the call
// is hierarchy-conformant. A fallback is only used when the judge chain is unseeded (bootstrap).

/** Stable ids for the seeded system judge agent + pipeline (created per org). */
export const AI_QUALITY_JUDGE_AGENT_ID = 'agent_system_ai_quality_judge';
export const AI_QUALITY_JUDGE_PIPELINE_ID = 'pl_system_ai_quality_judge';

export interface JudgeAgentLike {
  id: string;
  pipelineId: string | null;
}
export interface JudgePipelineLike {
  id: string;
  gatewayId: string | null;
  defaultModel: string | null;
}
export interface JudgeGatewayLike {
  id: string;
  defaultModel: string | null;
}

export interface JudgeRouting {
  /** The model to send to the gateway — pipeline defaultModel wins, else the gateway's, else fallback. */
  model: string;
  agentId: string | null;
  pipelineId: string | null;
  gatewayId: string | null;
  /** true ⇒ resolved through a complete agent→pipeline→gateway chain (not the bootstrap fallback). */
  conformant: boolean;
  /** Operator-facing attribution line recorded on the eval run. */
  attribution: string;
}

/**
 * Resolve the judge's routing from the (already-loaded) agent/pipeline/gateway entities. PURE.
 *
 * conformant requires the FULL chain: a judge agent bound to a pipeline, that pipeline bound to a
 * gateway, and a model resolvable from the pipeline (preferred) or the gateway. Any break drops to
 * the bootstrap fallback model and conformant:false, so callers can surface "judge not yet wired
 * through the hierarchy" honestly rather than silently pinning a model.
 */
export function resolveJudgeRouting(input: {
  agent: JudgeAgentLike | null;
  pipeline: JudgePipelineLike | null;
  gateway: JudgeGatewayLike | null;
  fallbackModel: string;
}): JudgeRouting {
  const { agent, pipeline, gateway, fallbackModel } = input;
  const chainModel =
    (pipeline?.defaultModel?.trim() || gateway?.defaultModel?.trim() || '') || null;
  const boundToPipeline = !!agent && !!pipeline && agent.pipelineId === pipeline.id;
  const pipelineOnGateway = !!pipeline && !!gateway && pipeline.gatewayId === gateway.id;
  const conformant = boundToPipeline && pipelineOnGateway && chainModel !== null;

  if (conformant) {
    return {
      model: chainModel as string,
      agentId: agent!.id,
      pipelineId: pipeline!.id,
      gatewayId: gateway!.id,
      conformant: true,
      attribution: `judge=${agent!.id} pipeline=${pipeline!.id} gateway=${gateway!.id} model=${chainModel}`,
    };
  }
  return {
    model: chainModel ?? fallbackModel,
    agentId: agent?.id ?? null,
    pipelineId: pipeline?.id ?? null,
    gatewayId: gateway?.id ?? null,
    conformant: false,
    attribution: `judge chain incomplete — bootstrap fallback model=${chainModel ?? fallbackModel} (agent/pipeline/gateway not fully wired)`,
  };
}

export interface GatewayChoice {
  id: string;
  defaultModel: string | null;
  enabled: boolean;
  /** 'on-prem' ⇒ data stays local; 'cloud' ⇒ egresses. The judge prefers on-prem. */
  egressClass: string;
}

/**
 * Pick the gateway to bind the seeded judge pipeline to. PURE. The AI-quality judge sees real
 * production I/O (prompts + outputs + sources), so on a private deployment it must NOT silently
 * egress to a cloud model when a local one exists. Preference order, most-preferred first:
 *   1. enabled + on-prem + advertises a model  (governed AND local AND resolvable)
 *   2. enabled + on-prem                        (local, model inherited later)
 *   3. enabled + advertises a model             (cloud fallback only when no local gateway)
 *   4. enabled
 *   5. the first gateway that exists
 * Returns null when the org has no gateway — the caller keeps the honest bootstrap fallback rather
 * than binding the judge to a dead gateway.
 */
export function pickJudgeGateway(gateways: GatewayChoice[]): GatewayChoice | null {
  if (gateways.length === 0) return null;
  const onPrem = (g: GatewayChoice) => g.egressClass === 'on-prem';
  const hasModel = (g: GatewayChoice) => !!g.defaultModel?.trim();
  return (
    gateways.find((g) => g.enabled && onPrem(g) && hasModel(g)) ??
    gateways.find((g) => g.enabled && onPrem(g)) ??
    gateways.find((g) => g.enabled && hasModel(g)) ??
    gateways.find((g) => g.enabled) ??
    gateways[0]
  );
}
