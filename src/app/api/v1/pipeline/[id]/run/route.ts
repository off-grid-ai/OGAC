import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/store';
import { actorFrom } from '@/lib/audit-event';
import { ipFromRequest } from '@/lib/audit-actor';
import { getPipeline } from '@/lib/pipelines';
import { deriveEgress } from '@/lib/pipelines-policy';
import { verifyPipelineKey } from '@/lib/pipeline-api-keys';
import { pipelineTag } from '@/lib/pipeline-api-key-format';

export const dynamic = 'force-dynamic';

// ─── Public per-pipeline invocation — POST /api/v1/pipeline/<id>/run ───────────────────────────────
//
// This is how a pipeline is consumed as its OWN provisioned API by apps, agents, and external
// third-parties. The caller presents a per-pipeline provisioned key as `Authorization: Bearer og_pl_…`.
// The key is verified (SHA-256 hash lookup — shape alone never authenticates) back to a pipeline; the
// key must match THIS pipeline id in the URL, so a key minted for pipeline A can never drive pipeline B.
//
// GOVERNANCE APPLIES ON EVERY CALL — no bypass. The pipeline is the governed chokepoint: we load it,
// require it be published, and run the request's `data_class` through the pipeline's PURE routing leash
// (deriveEgress) BEFORE anything else. A `block` decision is honored (403) so a locked pipeline can
// never leak PII to cloud even through its provisioned key. Every call is audited against the pipeline.
//
// DEFERRED (logged as a gap): full model EXECUTION (dispatching the resolved gateway/model, running
// guardrail masking on the output, streaming a completion) is not wired here yet — apps run through
// submitAppRun; pipelines have no standalone executor. This route implements the REAL, tested key-auth
// + governed routing decision and returns a governed PLAN (the binding + egress verdict + what would
// run). Wiring the execution onto this governed decision is the remaining step.

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
  if (pipeline.status !== 'published') {
    return NextResponse.json({ error: 'pipeline is not published' }, { status: 409 });
  }

  // ── 3. Governance — run the request's data_class through the pipeline's routing leash (PURE) ────
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dataClass = typeof body.data_class === 'string' ? body.data_class : 'general';
  const egress = deriveEgress(pipeline.routing, dataClass);

  const actor = actorFrom({ clientId: `pipeline-key:${binding.keyId}`, name: 'Provisioned API key' });
  const ip = ipFromRequest(req);

  if (egress.effective === 'block') {
    recordAudit({
      actor,
      org: binding.orgId,
      project: pipelineTag(id),
      action: 'pipeline.invoke',
      resource: pipelineTag(id),
      outcome: 'blocked',
      ip,
    });
    return NextResponse.json(
      {
        object: 'pipeline_run',
        pipelineId: id,
        outcome: 'blocked',
        reason: `routing leash blocked egress for data_class="${dataClass}"`,
        egress,
      },
      { status: 403 },
    );
  }

  // ── 4. Governed plan (execution wiring deferred — see the header gap note) ──────────────────────
  recordAudit({
    actor,
    org: binding.orgId,
    project: pipelineTag(id),
    action: 'pipeline.invoke',
    resource: pipelineTag(id),
    model: pipeline.defaultModel ?? null,
    outcome: 'ok',
    ip,
  });

  return NextResponse.json(
    {
      object: 'pipeline_run',
      pipelineId: id,
      pipelineVersion: pipeline.version,
      outcome: 'ok',
      governed: true,
      plan: {
        gateway: pipeline.gateway ? { id: pipeline.gateway.id, name: pipeline.gateway.name } : null,
        model: pipeline.defaultModel ?? null,
        dataClass,
        egress,
      },
      // Echo the caller's input under governance so integrators can wire + test the contract now.
      input: body,
      note: 'Governed key-auth + routing decision applied. Model execution wiring is pending (gap).',
    },
    { status: 202 },
  );
}
