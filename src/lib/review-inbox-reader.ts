// ─── HITL review-inbox reader — SERVER-ONLY I/O (thin drizzle + store reads) ──────────────────────
//
// The I/O half of the reviewer inbox / detail. Split out from review-inbox.ts so the pure logic stays
// client-safe (no `pg` in the browser bundle). This file only READS — the awaiting app-runs, each
// run's app + its EFFECTIVE access policy, and (for the detail) the child agent-run trace — and hands
// the raw rows to the pure functions. It never re-implements a scoping/presentation rule.
//
// Disjoint from the WRITE path: approvals/rejections still flow through the existing review route
// (/api/v1/admin/apps/runs/[id]/review) → signalAppRun. This reader is READ-only.

import { getApp } from '@/lib/apps-store';
import { resolveAppAccessPolicy } from '@/lib/app-access';
import { type AppAccessCaller } from '@/lib/app-access-policy';
import {
  type ReviewAppLike,
  type ReviewInboxItem,
  type ReviewDetail,
  buildReviewDetail,
  childRunIdForReview,
  scopeInbox,
} from '@/lib/review-inbox';
import { getAppRunView, listAppRunsView } from '@/lib/app-runs-view-reader';
import { getReviewTrace } from '@/lib/review-trace-reader';

// resolveReviewApp — the app + its effective access policy, shaped for the pure logic. null when the
// app is gone (a run whose app was deleted is dropped from the inbox).
async function resolveReviewApp(appId: string, orgId: string): Promise<ReviewAppLike | null> {
  const app = await getApp(appId, orgId);
  if (!app) return null;
  const policy = await resolveAppAccessPolicy(appId, orgId, app.ownerId ?? '');
  return {
    id: app.id,
    title: app.title,
    summary: app.summary,
    ownerId: app.ownerId ?? '',
    policy,
  };
}

// ─── getReviewInbox — the reviewer's scoped queue of pending decisions ────────────────────────────
// Pulls every awaiting_human run in the org, resolves each run's app + policy ONCE (memoized per app
// id so N runs of the same app cost one policy read), then hands them to the pure scopeInbox with the
// caller. Newest first. This is the entry the /build/review page + the inbox route call.
export async function getReviewInbox(
  caller: AppAccessCaller,
  orgId: string,
  limit = 200,
): Promise<ReviewInboxItem[]> {
  const runs = await listAppRunsView(undefined, orgId, limit);
  const awaiting = runs.filter((r) => r.status === 'awaiting_human');

  const appsById = new Map<string, ReviewAppLike>();
  for (const run of awaiting) {
    if (appsById.has(run.appId)) continue;
    const app = await resolveReviewApp(run.appId, orgId);
    if (app) appsById.set(run.appId, app);
  }

  return scopeInbox(awaiting, appsById, caller);
}

// ─── getReviewDetail — the full plain-language detail for ONE pending run ──────────────────────────
// Loads the run, its app + policy, and the child agent trace; assembles them via the pure
// buildReviewDetail. Returns null when the run or its app is not found (org-scoped). Does NOT gate on
// reviewability here — the page decides how to render a non-awaiting run — but the detail carries the
// canApprove/blocked-reason so the UI surfaces authority gracefully.
export async function getReviewDetail(
  runId: string,
  caller: AppAccessCaller,
  orgId: string,
): Promise<ReviewDetail | null> {
  const run = await getAppRunView(runId, orgId);
  if (!run) return null;
  const app = await resolveReviewApp(run.appId, orgId);
  if (!app) return null;
  // The child agent-run backing the draft (citations + faithfulness + guardrail notes). Best-effort:
  // a missing trace degrades to "no trace" in the UI. Read via the thin trace reader (a direct row
  // read) — not the agent-run runtime — so this stays free of the gateway/audit chain.
  const childRunId = childRunIdForReview(run.steps);
  const trace = childRunId ? await getReviewTrace(childRunId).catch(() => null) : null;
  return buildReviewDetail(run, app, trace, caller);
}
