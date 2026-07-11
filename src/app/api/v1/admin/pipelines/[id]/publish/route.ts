import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  countGatingEvals,
  publishWithGate,
  resolveGatingJob,
  startPublishGate,
} from '@/lib/pipeline-release';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/pipelines/[id]/publish — publish THROUGH the release gate (M1 close-the-loop).
// Body (optional): { override?: boolean } — publish despite a failing gate (audited as an override).
//
// TWO paths, chosen by whether the pipeline has gating evals attached (M1-a — async publish gate):
//
//   • NO evals (ungated) → SYNCHRONOUS instant publish, exactly as before. Returns 200 with the
//     pipeline + the (ungated-pass) decision.
//   • ≥1 eval           → ASYNC. Running a real ragas eval through the Cloudflare edge can exceed the
//     ~100s timeout (HTTP 524) before a verdict returns. So we create a `gating` job, return 202
//     {status:'gating', jobId} IMMEDIATELY, and resolve the gate in the BACKGROUND (run evals →
//     publish-or-block → audit). The Quality tab polls GET .../publish/status?jobId= for the verdict.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const by = gate.user.email ?? 'service@offgrid.local';

  const body = (await req.json().catch(() => ({}))) as { override?: boolean };
  const override = body.override === true;

  // ── Async path: the pipeline has gating evals → kick a background gating job, return 202. ──────────
  const gatingEvals = await countGatingEvals(id).catch(() => 0);
  if (gatingEvals > 0) {
    const started = await startPublishGate(id, { orgId, by, override });
    if (!started) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
    const jobId = started.job.jobId;
    // Fire-and-forget: the eval chain + gate application run in the background. Errors are captured
    // inside resolveGatingJob (it records a blocked job with the reason) — nothing escapes.
    void resolveGatingJob(jobId, id, { orgId, by, override }).catch(() => {});
    return NextResponse.json({ status: 'gating', jobId, gatingEvals }, { status: 202 });
  }

  // ── Sync path: ungated / no evals → instant publish (unchanged behaviour). ─────────────────────────
  const result = await publishWithGate(id, { orgId, by, override });
  if (!result) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });

  if (result.blocked) {
    // Release gate blocked the publish — honest 422 with the reason + failing evals.
    return NextResponse.json(
      { error: 'release gate failed', decision: result.decision, blocked: true },
      { status: 422 },
    );
  }

  // Published (ungated pass or overridden). The store already froze the version snapshot; the
  // override path also audited. A clean ungated pass records the standard publish audit here.
  if (!result.overridden) {
    auditFromSession(gate, orgId, {
      action: 'pipeline.publish',
      resource: `pipeline:${id}`,
      outcome: 'ok',
    });
  }
  return NextResponse.json({
    status: 'published',
    pipeline: result.pipeline,
    decision: result.decision,
    overridden: result.overridden,
  });
}
