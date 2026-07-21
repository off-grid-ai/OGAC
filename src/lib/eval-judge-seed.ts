// I/O seed for the AI-quality judge as a hierarchy-conformant system agent. Governing invariant
// (docs/ENGINEERING.md): agent/app → pipeline → gateway → model. The eval/QA judge is an internal
// AI-using service, so it is fronted by a seeded system AGENT bound to a seeded PIPELINE bound to
// the org's GATEWAY — never an env-pinned model. Idempotent: safe to call repeatedly (createPipeline
// is onConflictDoNothing by stable id; the agent is only created when absent). Returns what it wired
// so the caller/route can report whether the judge chain is now conformant.

import {
  AI_QUALITY_JUDGE_AGENT_ID,
  AI_QUALITY_JUDGE_PIPELINE_ID,
  pickJudgeGateway,
  resolveJudgeRouting,
} from '@/lib/eval-judge';
import { listGatewayRows } from '@/lib/gateways';
import { createPipeline, updatePipeline } from '@/lib/pipelines';
import { createCustomAgent, getCustomAgent } from '@/lib/store';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

const JUDGE_SYSTEM_PROMPT =
  'You are the Off Grid AI-quality judge. You score AI outputs strictly and concisely for ' +
  'correctness, helpfulness, on-task focus, and faithfulness to provided sources. You return ' +
  'only the requested structured verdict — no preamble, no hedging.';

export interface JudgeSeedResult {
  seeded: boolean; // did a gateway exist to bind to
  conformant: boolean; // is the resolved chain fully hierarchy-conformant
  agentId: string;
  pipelineId: string;
  gatewayId: string | null;
  model: string;
  attribution: string;
}

/**
 * Ensure the judge pipeline + agent exist for an org, bound to a real gateway, and report the
 * resolved routing. When the org has no gateway, nothing is seeded (seeded:false) and the caller
 * keeps using the bootstrap fallback — an honest degrade, not a fake binding.
 */
export async function seedJudgeForOrg(orgId: string = DEFAULT_ORG): Promise<JudgeSeedResult> {
  const gateways = await listGatewayRows(orgId);
  const gateway = pickJudgeGateway(
    gateways.map((g) => ({
      id: g.id,
      defaultModel: g.defaultModel,
      enabled: g.enabled,
      egressClass: g.egressClass,
    })),
  );

  if (!gateway) {
    return {
      seeded: false,
      conformant: false,
      agentId: AI_QUALITY_JUDGE_AGENT_ID,
      pipelineId: AI_QUALITY_JUDGE_PIPELINE_ID,
      gatewayId: null,
      model: '',
      attribution: 'no gateway for org — judge chain unseeded (bootstrap fallback in effect)',
    };
  }

  // Pipeline: bound to the gateway, model inherited from the gateway's defaultModel (single source).
  // createPipeline is onConflictDoNothing by stable id, so on a re-seed it returns the EXISTING row
  // (possibly bound to a now-less-preferred gateway, e.g. cloud before an on-prem was added). Rebind
  // the pipeline whenever the preferred gateway/model has drifted so re-seeding actually re-governs.
  const desiredModel = gateway.defaultModel || null;
  let pipeline = await createPipeline(
    {
      id: AI_QUALITY_JUDGE_PIPELINE_ID,
      name: 'AI Quality Judge',
      description:
        'System pipeline fronting the AI-quality judge (evals, online QA scoring, RAG metrics). ' +
        'Routes judge calls through the governed gateway — the invariant applies to internal services too.',
      gatewayId: gateway.id,
      defaultModel: desiredModel,
      visibility: 'private',
      status: 'published',
    },
    'system',
    orgId,
  );
  if (pipeline.gatewayId !== gateway.id || pipeline.defaultModel !== desiredModel) {
    pipeline =
      (await updatePipeline(
        AI_QUALITY_JUDGE_PIPELINE_ID,
        { gatewayId: gateway.id, defaultModel: desiredModel },
        orgId,
        'system',
      )) ?? pipeline;
  }

  // Agent: bound to the pipeline. Only create when absent (createCustomAgent is not upsert).
  let agent = await getCustomAgent(AI_QUALITY_JUDGE_AGENT_ID, orgId);
  if (!agent) {
    agent = await createCustomAgent(
      {
        id: AI_QUALITY_JUDGE_AGENT_ID,
        name: 'AI Quality Judge',
        role: 'System',
        description: 'Scores AI outputs for quality and faithfulness. Fronts the eval/QA judge.',
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        grounded: false,
        trigger: 'on-demand',
        pipelineId: pipeline.id,
      },
      orgId,
    );
  }

  const routing = resolveJudgeRouting({
    agent: { id: agent.id, pipelineId: agent.pipelineId },
    pipeline: { id: pipeline.id, gatewayId: pipeline.gatewayId, defaultModel: pipeline.defaultModel },
    gateway: { id: gateway.id, defaultModel: gateway.defaultModel },
    fallbackModel: gateway.defaultModel || '',
  });

  return {
    seeded: true,
    conformant: routing.conformant,
    agentId: routing.agentId ?? AI_QUALITY_JUDGE_AGENT_ID,
    pipelineId: routing.pipelineId ?? AI_QUALITY_JUDGE_PIPELINE_ID,
    gatewayId: routing.gatewayId,
    model: routing.model,
    attribution: routing.attribution,
  };
}
