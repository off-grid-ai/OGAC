// ─── Reading the operational evidence a compliance pack must carry (I/O) ───────────────────────────
//
// ROADMAP §10 Flow 8 step 2. The pure section builders live in evidence-sections.ts; this is the thin
// read layer that gets them their facts, org-scoped, over a window.
//
// Everything here is best-effort in the SAFE direction: a query that fails returns zeroes AND the
// caller renders "none recorded in <period>" — which is honest for an empty system and detectably
// wrong for a busy one. What it must never do is throw, because a pack that fails to generate teaches
// a compliance team to stop asking for it.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type {
  ApprovalEvidence,
  EvaluationEvidence,
  RunEvidence,
} from '@/lib/reports/evidence-sections';

export interface OperationalEvidence {
  runs: RunEvidence;
  approvals: ApprovalEvidence;
  evaluations: EvaluationEvidence;
  from: string | null;
  to: string | null;
}

const EMPTY: OperationalEvidence = {
  runs: { total: 0, completed: 0, failed: 0, awaitingHuman: 0, signed: 0 },
  approvals: { decisions: 0, approved: 0, rejected: 0, escalated: 0, reviewers: 0 },
  evaluations: { runs: 0, suites: [] },
  from: null,
  to: null,
};

/** Runs, approvals and evaluations for one org over a window (default: the last 30 days). */
export async function readOperationalEvidence(
  orgId: string,
  windowDays = 30,
): Promise<OperationalEvidence> {
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const out: OperationalEvidence = {
    ...EMPTY,
    from: from.toISOString(),
    to: to.toISOString(),
  };

  try {
    const runs = await db.execute<{
      total: number;
      completed: number;
      failed: number;
      awaiting: number;
      signed: number;
    }>(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'done')::int AS completed,
             count(*) FILTER (WHERE status IN ('error','cancelled'))::int AS failed,
             count(*) FILTER (WHERE status = 'awaiting_human')::int AS awaiting,
             count(*) FILTER (WHERE provenance IS NOT NULL)::int AS signed
      FROM app_runs
      WHERE org_id = ${orgId} AND started_at >= ${from.toISOString()}
    `);
    const r = runs.rows[0];
    if (r) {
      out.runs = {
        total: r.total,
        completed: r.completed,
        failed: r.failed,
        awaitingHuman: r.awaiting,
        signed: r.signed,
      };
    }
  } catch {
    /* leave zeroes; the section says "none recorded", never an empty table */
  }

  try {
    // Approvals are read from the AUDIT LEDGER rather than from run rows: the ledger is the record a
    // regulator is entitled to, it survives a run being deleted, and it carries the actor.
    const approvals = await db.execute<{
      decisions: number;
      approved: number;
      rejected: number;
      escalated: number;
      reviewers: number;
    }>(sql`
      SELECT count(*) FILTER (WHERE action IN ('app.run.review','app.run.escalated'))::int AS decisions,
             count(*) FILTER (WHERE action = 'app.run.review' AND outcome = 'ok')::int AS approved,
             count(*) FILTER (WHERE action = 'app.run.review' AND outcome IN ('blocked','error'))::int AS rejected,
             count(*) FILTER (WHERE action = 'app.run.escalated')::int AS escalated,
             count(DISTINCT actor_id) FILTER (WHERE action IN ('app.run.review','app.run.escalated'))::int AS reviewers
      FROM audit_events_v2
      WHERE org = ${orgId} AND ts >= ${from.toISOString()}
    `);
    const a = approvals.rows[0];
    if (a) out.approvals = a;
  } catch {
    /* as above */
  }

  try {
    const evals = await db.execute<{
      engine: string;
      runs: number;
      last_score: number | null;
      last_at: string | null;
    }>(sql`
      SELECT engine,
             count(*)::int AS runs,
             (array_agg(score ORDER BY started_at DESC))[1] AS last_score,
             max(started_at)::text AS last_at
      FROM eval_runs
      WHERE org_id = ${orgId} AND started_at >= ${from.toISOString()}
      GROUP BY engine ORDER BY count(*) DESC
    `);
    out.evaluations = {
      runs: evals.rows.reduce((sum, row) => sum + row.runs, 0),
      suites: evals.rows.map((row) => ({
        engine: row.engine,
        runs: row.runs,
        lastScore: row.last_score === null ? null : Math.round(Number(row.last_score)),
        lastAt: row.last_at,
      })),
    };
  } catch {
    /* as above */
  }

  return out;
}
