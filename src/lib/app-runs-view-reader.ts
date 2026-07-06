// ─── App-runs view reader (Builder Epic Phase 4A) — SERVER-ONLY thin drizzle reads ────────────────
//
// The I/O half of the RUNNING/REVIEW read path. Split out from app-runs-view.ts so the pure view
// logic stays client-safe (no `pg` in the browser bundle); this file imports the DB and shapes rows
// into the client-safe AppRunView via the pure `toAppRunView` mapper. It never re-implements a
// scheduling rule — it only reads the `app_runs` row(s). Disjoint from app-run-store.ts (2A, WRITE).

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { appRuns } from '@/db/schema';
import { type AppRunView, toAppRunView } from '@/lib/app-runs-view';

const DEFAULT_ORG = 'default';

// getAppRunView — a single run by id, org-scoped, shaped for the screens. null if not found.
export async function getAppRunView(id: string, orgId: string = DEFAULT_ORG): Promise<AppRunView | null> {
  const [row] = await db
    .select()
    .from(appRuns)
    .where(and(eq(appRuns.id, id), eq(appRuns.orgId, orgId)))
    .limit(1);
  return row ? toAppRunView(row) : null;
}

// listAppRunsView — recent runs, optionally filtered to one app, newest first. Backs the runs LIST
// (GET /api/v1/admin/app-runs?appId=) the operator uses to find a run to watch or review.
export async function listAppRunsView(
  appId: string | undefined,
  orgId: string = DEFAULT_ORG,
  limit = 50,
): Promise<AppRunView[]> {
  const where = appId
    ? and(eq(appRuns.orgId, orgId), eq(appRuns.appId, appId))
    : eq(appRuns.orgId, orgId);
  const rows = await db
    .select()
    .from(appRuns)
    .where(where)
    .orderBy(desc(appRuns.startedAt))
    .limit(limit);
  return rows.map(toAppRunView);
}
