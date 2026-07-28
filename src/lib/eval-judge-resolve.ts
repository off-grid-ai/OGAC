// I/O resolver for the eval/QA judge's routing — loads the seeded system judge agent → its pipeline
// → that pipeline's gateway, and hands the entities to the PURE resolveJudgeRouting. This is the one
// place the QA layer resolves its model, so eval-runner / adapters/evals / qa-scoring stop pinning
// OFFGRID_EVAL_MODEL and instead route through the agent→pipeline→gateway hierarchy (the governing
// invariant). Never throws: on any load failure it returns the pure resolver's non-conformant
// bootstrap fallback so a missing seed degrades honestly rather than crashing an eval.

import { judgeAgentId, type JudgeRouting, resolveJudgeRouting } from '@/lib/eval-judge';
import { getGatewayRow } from '@/lib/gateways';
import { getPipeline } from '@/lib/pipelines';
import { getCustomAgent } from '@/lib/store';

/** The bootstrap fallback model, used ONLY until the judge agent/pipeline/gateway are seeded. */
function fallbackModel(): string {
  return process.env.OFFGRID_EVAL_MODEL?.trim() || 'gemma-4-e4b';
}

interface JudgeChain {
  agent: { id: string; pipelineId: string | null } | null;
  pipeline: { id: string; gatewayId: string | null; defaultModel: string | null } | null;
  gateway: { id: string; defaultModel: string | null } | null;
}

const EMPTY_CHAIN: JudgeChain = { agent: null, pipeline: null, gateway: null };

/** Walk agent → pipeline → gateway, stopping at the first link that is not wired. */
async function loadJudgeChain(orgId: string): Promise<JudgeChain> {
  const agent = (await getCustomAgent(judgeAgentId(orgId), orgId)) ?? null;
  const pipeline = agent?.pipelineId ? await getPipeline(agent.pipelineId, orgId) : null;
  const gateway = pipeline?.gatewayId ? await getGatewayRow(pipeline.gatewayId, orgId) : null;
  // Project each row onto the minimal shape the pure resolver needs — it must not depend on the
  // full DB row types, so a schema change cannot reach the routing rule.
  return {
    agent: pick(agent, (a) => ({ id: a.id, pipelineId: a.pipelineId })),
    pipeline: pick(pipeline, (pl) => ({
      id: pl.id,
      gatewayId: pl.gatewayId,
      defaultModel: pl.defaultModel,
    })),
    gateway: pick(gateway, (gw) => ({ id: gw.id, defaultModel: gw.defaultModel })),
  };
}

/** Project a maybe-row onto a smaller shape, preserving "absent" as null. */
function pick<T, R>(row: T | null | undefined, onto: (row: T) => R): R | null {
  return row ? onto(row) : null;
}

export async function loadJudgeRouting(orgId: string): Promise<JudgeRouting> {
  // An unreachable DB yields an EMPTY chain, not a thrown error: resolveJudgeRouting then returns the
  // honest bootstrap fallback, so the judge still runs and says its chain is unwired.
  const chain = await loadJudgeChain(orgId).catch(() => EMPTY_CHAIN);
  return resolveJudgeRouting({ ...chain, fallbackModel: fallbackModel() });
}
