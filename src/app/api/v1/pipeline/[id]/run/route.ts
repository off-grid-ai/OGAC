import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { ipFromRequest } from '@/lib/audit-actor';
import { actorFrom } from '@/lib/audit-event';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { verifyPipelineKey } from '@/lib/pipeline-api-keys';
import { resolveContract } from '@/lib/pipeline-contract';
import { enforceModelCall } from '@/lib/pipeline-enforcement';
import { executePipelineRun } from '@/lib/pipeline-execute';
import { defaultExecuteDeps } from '@/lib/pipeline-execute-wiring';
import { isConsumable } from '@/lib/pipeline-lifecycle-model';
import { getPipeline } from '@/lib/pipelines';
import { deriveEgress } from '@/lib/pipelines-policy';
import { recordAudit } from '@/lib/store';

export const dynamic = 'force-dynamic';

// ─── Public per-pipeline invocation — POST /api/v1/pipeline/<id>/run ───────────────────────────────
//
// This is how a pipeline is consumed as its OWN provisioned API by apps, agents, and external
// third-parties. The caller presents a per-pipeline provisioned key as `Authorization: Bearer og_pl_…`.
// The key is verified (SHA-256 hash lookup — shape alone never authenticates) back to a pipeline; the
// key must match THIS pipeline id in the URL, so a key minted for pipeline A can never drive pipeline B.
//
// GOVERNANCE APPLIES ON EVERY CALL — no bypass. The pipeline is the governed chokepoint:
//   1. key-auth (valid, non-revoked, minted for THIS pipeline),
//   2. the pipeline must exist AND be published,
//   3. the request's `data_class` runs through the pipeline's CONTRACT (routing egress leash + the
//      policy/guardrail overlay) via the PURE enforceModelCall — the SAME verdict the agent-run/chat
//      paths use — so a `block` verdict is honored (403): a locked pipeline can never leak PII to
//      cloud even through its provisioned key,
//   4. the call is then EXECUTED end-to-end through the governed gateway path (input guardrails →
//      PII-mask-before-model when the overlay requires it → the real model call → output guardrails),
//      returning the real completion + governance metadata (model, egress, run id, usage, checks).
//
// HONEST: a mis-provisioned pipeline returns a clean 409; a gateway outage / empty completion returns
// a clean 502 — NEVER a fabricated 200. Every call is audited against the pipeline (correlated by the
// minted run id).

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = `plrun_${randomUUID().slice(0, 8)}`;

  // ── 1. Authenticate the provisioned key (real: SHA-256 hash lookup, not shape) ──────────────────
  const binding = await verifyPipelineKey(bearer(req));
  if (!binding) {
    return NextResponse.json(
      { error: 'unauthorized — present a valid pipeline key as Authorization: Bearer og_pl_…' },
      { status: 401 },
    );
  }
  // The key must belong to THIS pipeline (a key for pipeline A can't drive pipeline B).
  if (binding.pipelineId !== id) {
    return NextResponse.json({ error: 'key is not valid for this pipeline' }, { status: 403 });
  }

  // ── 2. Load the pipeline, org-scoped to the key's org; it must exist AND be published ───────────
  const pipeline = await getPipeline(id, binding.orgId);
  if (!pipeline) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  if (!isConsumable(pipeline.status)) {
    return NextResponse.json({ error: 'pipeline is not published' }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dataClass = typeof body.data_class === 'string' ? body.data_class : 'general';

  const actor = actorFrom({ clientId: `pipeline-key:${binding.keyId}`, name: 'Provisioned API key' });
  const ip = ipFromRequest(req);

  // ── 3. Governance — the FULL contract decision (egress leash + policy/guardrail overlay), PURE ──
  // resolveContract loads the enforceable contract (data allowlist + routing + overlays merged over
  // the org baseline); enforceModelCall is the same pure verdict the agent-run/chat paths use, so the
  // public API is leashed IDENTICALLY. A block ⇒ 403 (audited), no execution.
  const contract = await resolveContract(id, binding.orgId);
  const verdict = enforceModelCall(contract, dataClass);
  // The leash may pin a specific model for this data-class — surface it so the plan can prefer it.
  const leashModel = deriveEgress(pipeline.routing, dataClass).model;

  if (!verdict.allow) {
    recordAudit({
      actor,
      org: binding.orgId,
      project: pipelineTag(id),
      action: 'pipeline.invoke',
      resource: `${pipelineTag(id)} — ${verdict.reason}`,
      outcome: 'blocked',
      ip,
      runId,
    });
    return NextResponse.json(
      {
        object: 'pipeline_run',
        pipelineId: id,
        runId,
        outcome: 'blocked',
        reason: verdict.reason,
        egress: verdict.egress,
      },
      { status: 403 },
    );
  }

  // ── 4. EXECUTE end-to-end through the governed gateway path ─────────────────────────────────────
  const deps = defaultExecuteDeps(id, binding.orgId, runId);
  const result = await executePipelineRun(
    runId,
    {
      id: pipeline.id,
      version: pipeline.version,
      defaultModel: pipeline.defaultModel ?? null,
      gateway: pipeline.gateway ? { id: pipeline.gateway.id, name: pipeline.gateway.name } : null,
    },
    verdict,
    leashModel,
    body,
    binding.orgId,
    `pipeline-key:${binding.keyId}`,
    deps,
    // The deterministic request-shape gates (param ceilings/bounds/banned list + model allow/denylist)
    // ride on the same resolved contract — enforced in-path before the model call.
    { requestParamsPolicy: contract?.requestParamsPolicy, modelRules: contract?.modelRules },
  );

  // A guardrail block (or a missing prompt) → 403; the input never reached the model.
  if (result.status === 'blocked') {
    return NextResponse.json(
      {
        object: 'pipeline_run',
        pipelineId: id,
        runId,
        outcome: 'blocked',
        reason: result.reason,
        checks: result.checks,
      },
      { status: 403 },
    );
  }

  // A gateway outage / empty completion → a clean 502, NEVER a fabricated answer.
  if (result.status === 'error') {
    return NextResponse.json(
      { object: 'pipeline_run', pipelineId: id, runId, outcome: 'error', reason: result.reason },
      { status: 502 },
    );
  }

  // ── The governed result: the REAL completion + governance metadata ──────────────────────────────
  return NextResponse.json(
    {
      object: 'pipeline_run',
      pipelineId: id,
      pipelineVersion: pipeline.version,
      runId,
      outcome: 'ok',
      governed: true,
      output: result.output,
      model: result.model,
      egress: result.egress,
      masked: result.masked,
      usage: result.usage,
      checks: result.checks,
      gateway: pipeline.gateway ? { id: pipeline.gateway.id, name: pipeline.gateway.name } : null,
      dataClass,
    },
    { status: 200 },
  );
}
