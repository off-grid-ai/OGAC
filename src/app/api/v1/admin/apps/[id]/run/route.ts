import { NextResponse } from 'next/server';
import { submitAppRun } from '@/lib/adapters/apprun';
import { callerFromSession } from '@/lib/app-access-caller';
import { newAppRunId } from '@/lib/app-run';
import { evaluateBlastRadius, resolveRunMode, type RunMode } from '@/lib/app-run-controls';
import { getControls, usageFor } from '@/lib/app-run-controls-store';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { getApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { pipelineRunTag } from '@/lib/chat-pipeline-policy';
import { pipelineBindingHttpFailure } from '@/lib/pipeline-binding-http';
import { askerFrom } from '@/lib/retrieval/acl';
import { currentOrgId } from '@/lib/tenancy';

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

  const body = (await req.json().catch(() => ({}))) as {
    input?: Record<string, unknown>;
    mode?: RunMode;
  };
  const input = body.input && typeof body.input === 'object' ? body.input : {};
  const requestedMode: RunMode | undefined = body.mode === 'shadow' ? 'shadow' : undefined;

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

  // BLAST-RADIUS — the per-app safety dials, evaluated at RUN START (BEFORE any step executes). The
  // kill-switch (disabled), daily run cap, and spend cap are the pure evaluateBlastRadius decision over
  // the app's controls + the live usage counters (runs-today from app_runs, spend-today from the audit
  // ledger). Over-cap / disabled ⇒ 429 + a clear reason, audited run.denied. Absent controls row ⇒
  // DEFAULT_CONTROLS (no caps, enabled) ⇒ behaves exactly as before (additive). Composes WITH the
  // access + pipeline-contract gates above — an ADDITIONAL gate, not a replacement.
  const controls = await getControls(id, orgId);
  const usage = await usageFor(id, orgId, 0);
  const blast = evaluateBlastRadius(controls, usage);
  if (!blast.allow) {
    auditFromSession(gate, orgId, {
      action: 'app.run.denied',
      resource: `app:${id} blast-radius:${blast.code}`,
      outcome: 'blocked',
    });
    return NextResponse.json(
      { error: 'run denied by blast-radius controls', code: blast.code, reason: blast.reason },
      { status: 429 },
    );
  }

  // SHADOW MODE — the effective run mode (most-restrictive-wins): the app's shadowDefault forces
  // shadow; else an explicit ?mode=shadow request forces it; else live. In shadow the executor
  // intercepts side-effecting sinks (email/report/whatsapp) and records what they WOULD do.
  const runMode = resolveRunMode(requestedMode, controls);

  const runId = newAppRunId();

  let handle: Awaited<ReturnType<typeof submitAppRun>>;
  try {
    handle = await submitAppRun(app, input, {
      orgId,
      actor: gate.user.email ?? undefined,
      runId,
      asker: askerFrom(gate.user),
      mode: runMode,
    });
  } catch (error) {
    const failure = pipelineBindingHttpFailure(error);
    if (!failure) throw error;
    auditFromSession(gate, orgId, {
      action: 'app.run.denied',
      resource: `app:${id} pipeline-binding:${failure.body.code}`,
      outcome: 'blocked',
    });
    return NextResponse.json(failure.body, { status: failure.status });
  }

  // Tag the run audit with the resolved pipeline so the per-pipeline audit/FinOps lens lights up. The
  // RUN is the join key: stamp runId + a compound resource carrying the pipeline tag.
  const tag = pipelineRunTag(app.pipelineId ?? null);
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
  const base = {
    object: 'app_run',
    runId: handle.runId,
    mode: handle.mode,
    runMode,
    note: handle.note,
  };
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
