// The I/O executor for the DSAR erasure plan — the ONE place a plan step becomes an org-confined
// DELETE (DRY: both the /erasure and /erasure-requests routes route through this, so the RTBF
// cross-tenant guard can never drift between them). SECURITY #236 fix 3.
//
// The pure planner (erasure.ts) decides WHAT to erase and HOW each step is confined to the requesting
// org (buildErasureWhere). This module is the thin drizzle glue that binds those placeholders to real
// parameters and runs the DELETE. It never throws — a failing step is captured so the erasure is
// honestly reported as `partial`.

import { type SQL, sql } from 'drizzle-orm';
import { db } from '@/db';
import { buildErasureWhere, type PlanStep, type StepResult } from '@/lib/erasure';

// Turn a placeholder clause (`%SUBJECT%` / `%ORG%`) into a drizzle SQL fragment with BOUND params.
// The non-placeholder text is catalog-derived identifiers only (never user input) → sql.raw; the
// subject value + org are always bound parameters (no interpolation → no injection).
export function bindErasureClause(clause: string, subject: string, org: string): SQL {
  const parts = clause.split(/(%SUBJECT%|%ORG%)/);
  const frags: SQL[] = parts.map((p) =>
    p === '%SUBJECT%' ? sql`${subject}` : p === '%ORG%' ? sql`${org}` : sql.raw(p),
  );
  return sql.join(frags, sql``);
}

/**
 * Execute ONE erasure plan step as an ORG-CONFINED DELETE. A membership-scoped (user-global) table is
 * erased ONLY when the subject is a member of the requesting org (the membership probe finds an
 * org-scoped row), so an admin of org A can never wipe a person who exists only in org B. NEVER
 * throws — a failure is captured on the result so the report is honestly `partial`.
 */
export async function executeErasureStep(step: PlanStep): Promise<StepResult> {
  try {
    const where = buildErasureWhere(step);
    if (where.membershipProbe) {
      const probe = (await db.execute(
        bindErasureClause(where.membershipProbe, step.value, step.orgId),
      )) as unknown as { rowCount?: number | null; rows?: unknown[] };
      const isMember = (probe.rowCount ?? probe.rows?.length ?? 0) > 0;
      if (!isMember) {
        // Not a member of this org — skip (zero foreign rows touched).
        return { store: step.store, table: step.table, deleted: 0, error: null };
      }
    }
    const res = (await db.execute(
      sql`DELETE FROM ${sql.raw(step.table)} WHERE ${bindErasureClause(where.clause, step.value, step.orgId)}`,
    )) as unknown as { rowCount?: number | null };
    return { store: step.store, table: step.table, deleted: res.rowCount ?? 0, error: null };
  } catch (e) {
    return {
      store: step.store,
      table: step.table,
      deleted: 0,
      error: e instanceof Error ? e.message : 'delete failed',
    };
  }
}
