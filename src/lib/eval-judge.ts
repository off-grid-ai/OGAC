// ─── PURE eval-judge routing resolution (governing invariant) ────────────────────────────────────
//
// THE INVARIANT (docs/ENGINEERING.md): agent/app → pipeline → gateway → model. Nothing references a
// model or gateway directly. The eval/QA "LLM judge" is an internal AI-using service, so it MUST be
// fronted by a system agent bound to a pipeline; its model resolves through pipeline→gateway, never
// an env-pinned model id. This module is the pure resolver: given the judge agent + its pipeline +
// that pipeline's gateway (loaded by the I/O caller), decide the model to use and whether the call
// is hierarchy-conformant. A fallback is only used when the judge chain is unseeded (bootstrap).

// Stable, ORG-SCOPED ids for the seeded system judge agent + pipeline. The agents/pipelines tables
// key on a GLOBAL id PK, so the judge entities must carry the org in their id (same convention as the
// seeded gateways, e.g. gw_seed_org_bharat_onprem-cluster) — otherwise a second tenant collides with
// the first tenant's row and the seed fails. PURE (string building only).
export function judgeAgentId(orgId: string): string {
  return `agent_system_ai_quality_judge__${orgId}`;
}
export function judgePipelineId(orgId: string): string {
  return `pl_system_ai_quality_judge__${orgId}`;
}

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
  const chainModel = judgeChainModel(pipeline, gateway);

  // CONFORMANT means the whole governed chain is intact: the judge agent is bound to the pipeline,
  // that pipeline runs on the gateway, and the chain resolves a model. Anything less is the honest
  // bootstrap fallback — the judge still runs, but its attribution says the chain is not wired, so a
  // score is never presented as governed when it was not.
  if (isConformantChain(agent, pipeline, gateway) && chainModel !== null) {
    return {
      model: chainModel,
      agentId: agent!.id,
      pipelineId: pipeline!.id,
      gatewayId: gateway!.id,
      conformant: true,
      attribution: `judge=${agent!.id} pipeline=${pipeline!.id} gateway=${gateway!.id} model=${chainModel}`,
    };
  }

  return bootstrapRouting(agent, pipeline, gateway, chainModel ?? fallbackModel);
}

/**
 * The honest non-conformant result. PURE. The judge still runs — refusing to score would be worse —
 * but every id it could not resolve is reported as null and the attribution says the chain is
 * incomplete, so a score from an unwired judge is never mistaken for a governed one.
 */
function bootstrapRouting(
  agent: JudgeAgentLike | null,
  pipeline: JudgePipelineLike | null,
  gateway: JudgeGatewayLike | null,
  model: string,
): JudgeRouting {
  return {
    model,
    agentId: agent?.id ?? null,
    pipelineId: pipeline?.id ?? null,
    gatewayId: gateway?.id ?? null,
    conformant: false,
    attribution: `judge chain incomplete — bootstrap fallback model=${model} (agent/pipeline/gateway not fully wired)`,
  };
}

/** The model the governed chain resolves: the pipeline's, else the gateway's, else none. PURE. */
function judgeChainModel(
  pipeline: JudgePipelineLike | null,
  gateway: JudgeGatewayLike | null,
): string | null {
  const fromPipeline = pipeline?.defaultModel?.trim();
  if (fromPipeline) return fromPipeline;
  const fromGateway = gateway?.defaultModel?.trim();
  return fromGateway || null;
}

/** Is the agent → pipeline → gateway chain actually wired end to end? PURE. */
function isConformantChain(
  agent: JudgeAgentLike | null,
  pipeline: JudgePipelineLike | null,
  gateway: JudgeGatewayLike | null,
): boolean {
  if (!agent || !pipeline || !gateway) return false;
  return agent.pipelineId === pipeline.id && pipeline.gatewayId === gateway.id;
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
