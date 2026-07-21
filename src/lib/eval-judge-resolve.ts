// I/O resolver for the eval/QA judge's routing — loads the seeded system judge agent → its pipeline
// → that pipeline's gateway, and hands the entities to the PURE resolveJudgeRouting. This is the one
// place the QA layer resolves its model, so eval-runner / adapters/evals / qa-scoring stop pinning
// OFFGRID_EVAL_MODEL and instead route through the agent→pipeline→gateway hierarchy (the governing
// invariant). Never throws: on any load failure it returns the pure resolver's non-conformant
// bootstrap fallback so a missing seed degrades honestly rather than crashing an eval.

import {
  AI_QUALITY_JUDGE_AGENT_ID,
  type JudgeRouting,
  resolveJudgeRouting,
} from '@/lib/eval-judge';
import { getGatewayRow } from '@/lib/gateways';
import { getPipeline } from '@/lib/pipelines';
import { getCustomAgent } from '@/lib/store';

/** The bootstrap fallback model, used ONLY until the judge agent/pipeline/gateway are seeded. */
function fallbackModel(): string {
  return process.env.OFFGRID_EVAL_MODEL?.trim() || 'gemma-4-e4b';
}

export async function loadJudgeRouting(orgId: string): Promise<JudgeRouting> {
  try {
    const agent = (await getCustomAgent(AI_QUALITY_JUDGE_AGENT_ID, orgId)) ?? null;
    const pipeline = agent?.pipelineId ? await getPipeline(agent.pipelineId, orgId) : null;
    const gateway = pipeline?.gatewayId ? await getGatewayRow(pipeline.gatewayId, orgId) : null;
    return resolveJudgeRouting({
      agent: agent ? { id: agent.id, pipelineId: agent.pipelineId } : null,
      pipeline: pipeline
        ? { id: pipeline.id, gatewayId: pipeline.gatewayId, defaultModel: pipeline.defaultModel }
        : null,
      gateway: gateway ? { id: gateway.id, defaultModel: gateway.defaultModel } : null,
      fallbackModel: fallbackModel(),
    });
  } catch {
    return resolveJudgeRouting({
      agent: null,
      pipeline: null,
      gateway: null,
      fallbackModel: fallbackModel(),
    });
  }
}
