import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getApp } from '@/lib/apps-store';
import { newAppRunId } from '@/lib/app-run';
import { submitAppRun } from '@/lib/adapters/apprun';
import { pipelineRunTag, resolveConsumerPipeline } from '@/lib/chat-pipeline-policy';
import { resolveContract } from '@/lib/pipeline-contract';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { callerFromSession } from '@/lib/app-access-caller';

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

  // Per-app ACCESS CONTROL — the WHO/UNDER-WHAT-CONDITIONS gate, layered before the pipeline
  // contract. The run input doubles as the ABAC request attributes (e.g. amount thresholds). Denied →
  // 403 + reason, audited access.denied. Composes WITH (does not replace) org-scope + contract below.
  const caller = await callerFromSession(gate, orgId);
  const access = await enforceAppAccessWithSharing({
    appId: id,
    orgId,
    ownerId: app.ownerId,
    caller,
    action: 'run',
    requestAttrs: input,
  });
  if (!access.allow) {
    auditFromSession(gate, orgId, {
      action: 'access.denied',
      resource: `app:${id} run`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
  }

  const runId = newAppRunId();

  // PA-16 — resolve the bound-pipeline CONTRACT this run enforces (data allowlist + egress leash +
  // policy/guardrail overlay), most-specific-wins (app binding → org default). Threaded into the run
  // context so the inline executor enforces it per step. Null (no binding / unresolvable) ⇒ the run
  // behaves exactly as before (additive-only). The durable worker path resolves its own contract
  // (deferred gap — see docs/GAPS_BACKLOG.md PA-16); the inline path is enforced here.
  const pipelineId = resolveConsumerPipeline(app.pipelineId, null);
  const contract = await resolveContract(pipelineId, orgId);

  const handle = await submitAppRun(app, input, {
    orgId,
    actor: gate.user.email ?? undefined,
    runId,
    contract,
  });

  // Tag the run audit with the resolved pipeline so the per-pipeline audit/FinOps lens lights up. The
  // RUN is the join key: stamp runId + a compound resource carrying the pipeline tag.
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
