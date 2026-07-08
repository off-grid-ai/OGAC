import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { publishWithGate } from '@/lib/pipeline-release';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/pipelines/[id]/publish — publish THROUGH the release gate (M1 close-the-loop).
// Body (optional): { override?: boolean } — publish despite a failing gate (audited as an override).
//
// Runs the pipeline's attached evals, applies the pure release gate, and:
//   • gate pass / no evals → publishes (status→published, version bump, frozen snapshot);
//   • gate fail + no override → 422 with the decision (WHY it was blocked, which evals failed);
//   • gate fail + override → publishes + records a `pipeline.publish.override` audit.
// The gate decision is ALWAYS returned so the Quality tab surfaces the verdict either way.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const by = gate.user.email ?? 'service@offgrid.local';

  const body = (await req.json().catch(() => ({}))) as { override?: boolean };
  const result = await publishWithGate(id, { orgId, by, override: body.override === true });
  if (!result) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });

  if (result.blocked) {
    // Release gate blocked the publish — honest 422 with the reason + failing evals.
    return NextResponse.json(
      { error: 'release gate failed', decision: result.decision, blocked: true },
      { status: 422 },
    );
  }

  // Published (gate pass, ungated, or overridden). The store already froze the version snapshot; the
  // override path also audited. A clean gated/ungated pass records the standard publish audit here.
  if (!result.overridden) {
    auditFromSession(gate, orgId, {
      action: 'pipeline.publish',
      resource: `pipeline:${id}`,
      outcome: 'ok',
    });
  }
  return NextResponse.json({
    pipeline: result.pipeline,
    decision: result.decision,
    overridden: result.overridden,
  });
}
