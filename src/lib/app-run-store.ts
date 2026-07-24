// ─── App-run store (Builder Epic Phase 2A) — thin I/O over the `appRuns` table ──────────────────
//
// Persists the live per-step state of a multi-step app-run so screens 3 (RUNNING) + 4 (REVIEW) read
// a real trace. SOLID: the scheduling/reducer decisions are pure in app-run-plan.ts; this file is
// the storage adapter only — it maps the pure AppRunState → the `app_runs` row and upserts it.
//
// It never re-implements a scheduling rule. The orchestrator (app-run.ts) calls `upsertAppRunState`
// on run start and after every step transition; the read helpers back the status/review screens.

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { appRuns } from '@/db/schema';
import type { AppRun as AppRunRow } from '@/db/schema';
import type { AppRunState, StepState } from '@/lib/app-run-plan';

const DEFAULT_ORG = 'default';

// Map the pure per-step state → the jsonb row shape (schema.ts appRuns.steps).
function toRowSteps(steps: StepState[]): AppRunRow['steps'] {
  return steps.map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    status: s.status,
    outcome: s.output,
    refs: (s.refs ?? []).map((r) => r.name),
    detail: s.detail,
    childRunId: s.childRunId,
    reviewer: s.reviewer,
    wouldPerform: s.wouldPerform,
    actionImpact: s.actionImpact,
    actionReceipt: s.actionReceipt,
    deliveryReceipt: s.deliveryReceipt,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
  }));
}

// The aggregate outcome persisted on the row = the last non-empty step output.
function aggregateOutcome(steps: StepState[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const o = steps[i].output;
    if (o?.trim()) return o;
  }
  return '';
}

// ─── upsertAppRunState — create the run row on first write, update it thereafter ─────────────────
// Idempotent by runId (the app-run's primary key). Called on start (all steps queued) and after
// every step transition. `orgId`/`appId` come from the pure state; `input` is the trigger/form input.
export async function upsertAppRunState(
  state: AppRunState,
  input: Record<string, unknown> = {},
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  const finished =
    state.status === 'done' || state.status === 'error' || state.status === 'cancelled';
  const values = {
    id: state.runId,
    orgId,
    appId: state.appId,
    status: state.status,
    input,
    steps: toRowSteps(state.steps),
    outcome: aggregateOutcome(state.steps),
    ...(finished ? { finishedAt: new Date() } : {}),
  };
  await db
    .insert(appRuns)
    .values(values)
    .onConflictDoUpdate({
      target: appRuns.id,
      set: {
        status: values.status,
        steps: values.steps,
        outcome: values.outcome,
        ...(finished ? { finishedAt: new Date() } : {}),
      },
    });
}

// Mark an app run cancelled after its durable workflow was cancelled/terminated from the console
// (run-actions). A force-terminate kills the workflow without running the cleanup that would persist
// the terminal state, so the operator-visible row must be reconciled here — org-scoped, and only
// from an in-flight state (never overwrite a done/error terminal record). Returns whether a row moved.
export async function markAppRunCancelled(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  const updated = await db
    .update(appRuns)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(
      and(
        eq(appRuns.id, id),
        eq(appRuns.orgId, orgId),
        inArray(appRuns.status, ['running', 'awaiting_human', 'queued']),
      ),
    )
    .returning({ id: appRuns.id });
  return updated.length > 0;
}

// ─── reads (back the status / review / analytics screens) ────────────────────────────────────────

export async function getAppRun(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<AppRunRow | null> {
  const [row] = await db
    .select()
    .from(appRuns)
    .where(and(eq(appRuns.id, id), eq(appRuns.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function listAppRuns(
  appId: string,
  orgId: string = DEFAULT_ORG,
  limit = 50,
): Promise<AppRunRow[]> {
  return db
    .select()
    .from(appRuns)
    .where(and(eq(appRuns.appId, appId), eq(appRuns.orgId, orgId)))
    .orderBy(desc(appRuns.startedAt))
    .limit(limit);
}
