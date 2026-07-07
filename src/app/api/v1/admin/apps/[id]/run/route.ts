import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getApp } from '@/lib/apps-store';
import { newAppRunId } from '@/lib/app-run';
import { submitAppRun } from '@/lib/adapters/apprun';
import { pipelineRunTag, resolveConsumerPipeline } from '@/lib/chat-pipeline-policy';

export const dynamic = 'force-dynamic';

// ─── App test-run route (Builder Epic Phase 3A — the INPUT screen's "Run") ────────────────────────
// POST /api/v1/admin/apps/[id]/run { input } → submits the saved AppSpec through submitAppRun, which
// routes DURABLY (Temporal) when the spec shouldRunDurably (multi-step OR has a human step) so a
// paused human step can be RESUMED from the Review screen, and INLINE otherwise (GAP #114). When the
// durable worker/Temporal is off, submitAppRun degrades gracefully to inline — we surface that
// honestly in the response (mode + note) so the operator knows a HITL test-run won't be resumable.
//
// SOLID: thin handler — auth, org, load the spec, mint a run id, delegate to submitAppRun. All
// execution + routing logic lives behind the adapter/app-run.ts (governed per-step pipeline).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { input?: Record<string, unknown> };
  const input = body.input && typeof body.input === 'object' ? body.input : {};

  const runId = newAppRunId();
  const handle = await submitAppRun(app, input, {
    orgId,
    actor: gate.user.email ?? undefined,
    runId,
  });

  // Resolve + tag the bound pipeline (CONSUMERS-BIND #166) so telemetry/governance lenses light up.
  // The RUN is the join key: we stamp the audit event with the runId and a compound resource that
  // carries the pipeline tag (`app:<id> pipeline:<pl>`), reusing the canonical audit path.
  const pipelineId = resolveConsumerPipeline(app.pipelineId, null);
  const tag = pipelineRunTag(pipelineId);
  auditFromSession(gate, orgId, {
    action: 'app.run',
    resource: tag ? `app:${id} ${tag}` : `app:${id}`,
    runId,
    outcome: handle.status === 'error' ? 'error' : 'ok',
  });

  // Shape the response so the console gets a consistent app_run body regardless of path:
  //   • durable → the started handle (runId/workflowId/mode/status/note); poll for live status.
  //   • inline  → the full outcome (steps + aggregate) spread in, as before, plus the mode/note so a
  //     HITL app that fell back to inline is honestly flagged (its human step returns awaiting_human
  //     and can't be resumed on the inline path).
  const base = { object: 'app_run', runId: handle.runId, mode: handle.mode, note: handle.note };
  if (handle.outcome) {
    return NextResponse.json({ ...base, ...handle.outcome });
  }
  return NextResponse.json({
    ...base,
    workflowId: handle.workflowId,
    status: handle.status ?? 'running',
    steps: [],
    outcome: '',
  });
}
