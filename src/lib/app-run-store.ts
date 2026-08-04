// ─── App-run store (Builder Epic Phase 2A) — thin I/O over the `appRuns` table ──────────────────
//
// Persists the live per-step state of a multi-step app-run so screens 3 (RUNNING) + 4 (REVIEW) read
// a real trace. SOLID: the scheduling/reducer decisions are pure in app-run-plan.ts; this file is
// the storage adapter only — it maps the pure AppRunState → the `app_runs` row and upserts it.
//
// It never re-implements a scheduling rule. The orchestrator (app-run.ts) calls `upsertAppRunState`
// on run start and after every step transition; the read helpers back the status/review screens.

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appRuns } from '@/db/schema';
import type { AppRun as AppRunRow } from '@/db/schema';
import type { AppRunState, StepState } from '@/lib/app-run-plan';
import { currentPolicyVersion } from '@/lib/policy-versions-store';
import { appendEscalation, type EscalationRecord } from '@/lib/review-escalation';

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
    egress: s.egress,
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
// Self-migrating, like the other stores here, so the column exists without a separate migration step.
let ensuredColumn: Promise<void> | null = null;
async function ensureAppVersionColumn(): Promise<void> {
  ensuredColumn ??= db
    .execute(sql`ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS app_version integer;`)
    .then(() => db.execute(sql`ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS data_classification text;`))
    .then(() => db.execute(sql`ALTER TABLE data_domains ADD COLUMN IF NOT EXISTS classification text;`))
    .then(() => db.execute(sql`ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS policy_version integer;`))
    .then(() => db.execute(sql`ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS lawful_basis text;`))
    .then(() => db.execute(sql`ALTER TABLE data_domains ADD COLUMN IF NOT EXISTS lawful_basis text;`))
    .then(() => db.execute(sql`ALTER TABLE data_domains ADD COLUMN IF NOT EXISTS purpose text;`))
    .then(() => undefined)
    .catch((e) => {
      ensuredColumn = null;
      throw e;
    });
  return ensuredColumn;
}

export async function upsertAppRunState(
  state: AppRunState,
  input: Record<string, unknown> = {},
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureAppVersionColumn();
  const policyVersion = await currentPolicyVersion(orgId).catch(() => 0);
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
    // The version that produced this run, so an incident can name the blast radius.
    ...(state.appVersion != null ? { appVersion: state.appVersion } : {}),
    // The sensitivity of what it read, so "which models saw Confidential data" is a query.
    ...(state.dataClassification != null ? { dataClassification: state.dataClassification } : {}),
    // WHY WE WERE PERMITTED TO. The lawful basis the run relied on, or the honest gap when a source
    // it read has none recorded.
    ...(state.lawfulBasis != null ? { lawfulBasis: state.lawfulBasis } : {}),
    // WHICH POLICY WAS IN FORCE. Rules are edited in place, so without this a run reviewed months
    // later is judged against today's policy — which may have been rewritten since. Set on the
    // insert only (absent from the `set` clause below) so a mid-flight policy change cannot
    // retroactively re-attribute a run that already started under the old one.
    ...(policyVersion > 0 ? { policyVersion } : {}),
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
        // Never overwritten with null on a later write: a resume must not erase the version the run
        // actually started on.
        ...(state.appVersion != null ? { appVersion: state.appVersion } : {}),
        ...(state.dataClassification != null ? { dataClassification: state.dataClassification } : {}),
        ...(state.lawfulBasis != null ? { lawfulBasis: state.lawfulBasis } : {}),
        ...(finished ? { finishedAt: new Date() } : {}),
      },
    });

  // A finished app run becomes a retained quality verdict, so answer-quality regression covers apps
  // and not just agents. This is the ONE place both execution paths (inline runApp and the durable
  // Temporal workflow) converge, so the trigger belongs here rather than duplicated at each caller.
  // Out-of-band and best-effort: scoreAppRun never throws, and it is deliberately not awaited into
  // the run's critical path — persisting the run must not wait on a judge.
  if (finished) {
    const { scoreAppRun } = await import('@/lib/qa/app-run-score');
    void scoreAppRun(state, input, orgId);
  }
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

// ─── escalate — hand the pending decision on, WITHOUT deciding it ────────────────────────────────
//
// ROADMAP §10 Flow 6 step 4. The run stays `awaiting_human`: an escalation is a hand-off, not an
// outcome, and treating it as one would resume a workflow nobody approved. The chain is written onto
// the awaiting STEP so the next reviewer opens the item and reads why it reached them.
//
// Returns the applied record, or null when there is no step awaiting a human — the caller then reports
// that honestly rather than pretending an escalation happened.
export async function escalateAppRun(
  id: string,
  orgId: string,
  record: EscalationRecord,
): Promise<{ stepId: string; chain: EscalationRecord[] } | null> {
  const run = await getAppRun(id, orgId);
  if (!run || run.status !== 'awaiting_human') return null;
  const steps = run.steps ?? [];
  const index = steps.findIndex((s) => s.status === 'awaiting_human');
  if (index < 0) return null;

  const chain = appendEscalation(steps[index].escalations, record);
  const next = steps.map((s, i) => (i === index ? { ...s, escalations: chain } : s));
  await db
    .update(appRuns)
    .set({ steps: next as never })
    .where(and(eq(appRuns.id, id), eq(appRuns.orgId, orgId), eq(appRuns.status, 'awaiting_human')));
  return { stepId: steps[index].id, chain };
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
