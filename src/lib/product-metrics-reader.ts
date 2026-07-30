// ─── §13 product metrics reader — SERVER-ONLY thin I/O ─────────────────────────────────────────────
//
// The I/O half for `product-metrics.ts`. Split for the same reason as
// app-runs-view.ts / app-runs-view-reader.ts: the arithmetic stays pure and exhaustively testable with no
// DB, and this file does nothing but fetch rows and hand them over. It re-implements no rule — if a number
// here looks wrong, the fix belongs in the pure module or in this file's query, never in both.
//
// Org-scoped throughout. A metrics surface that leaked another tenant's run counts would be the same class
// of defect as the cross-org retrieval leak closed earlier, and "percentage of AI activity" is exactly the
// kind of aggregate where a missing WHERE goes unnoticed because the number still looks plausible.
import { and, eq, gte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { appRuns, apps } from '@/db/schema';
import {
  type MetricApp,
  type MetricAudit,
  type MetricRun,
  type ProductMetrics,
  assembleProductMetrics,
} from '@/lib/product-metrics';

const DEFAULT_ORG = 'default';

/** ISO timestamp `days` ago, for the window filter. */
function since(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Compute §13's derivable metrics for one org over a trailing window.
 *
 * Best-effort by design: a failed read yields `null`, never a zeroed report. A metrics page showing
 * "0 successful runs" when the query failed is precisely the failure-presenting-as-emptiness defect this
 * codebase keeps producing — a caller must be able to tell "we could not measure" from "the answer is zero",
 * which is the same reason the pure module reports `null` for an empty denominator.
 */
export async function computeProductMetrics(
  orgId: string = DEFAULT_ORG,
  windowDays = 30,
): Promise<ProductMetrics | null> {
  const from = new Date(since(windowDays));
  try {
    const [runRows, appRows] = await Promise.all([
      db
        .select({
          id: appRuns.id,
          status: appRuns.status,
          appId: appRuns.appId,
          startedAt: appRuns.startedAt,
          finishedAt: appRuns.finishedAt,
        })
        .from(appRuns)
        .where(and(eq(appRuns.orgId, orgId), gte(appRuns.startedAt, from))),
      db
        .select({ id: apps.id, pipelineId: apps.pipelineId, isTemplate: apps.isTemplate })
        .from(apps)
        .where(eq(apps.orgId, orgId)),
    ]);

    // A run's governed pipeline comes from its APP — app_runs carries no pipeline column, so reading
    // `run.pipelineId` directly would have silently reported 0% governed activity while every run was in
    // fact bound. Exactly the dropped-field shape this session kept finding, so it is joined explicitly.
    const pipelineByApp = new Map(appRows.map((a) => [a.id, a.pipelineId ?? null]));

    const runs: MetricRun[] = runRows.map((r) => ({
      id: r.id,
      status: String(r.status ?? ''),
      appId: r.appId ?? undefined,
      pipelineId: r.appId ? (pipelineByApp.get(r.appId) ?? null) : null,
      startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : undefined,
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : undefined,
    }));

    // `isTemplate` marks a template itself, not an app BUILT from one; app→template lineage lives in the
    // `lineage` column and is not read here. So template adoption is reported over what we can actually
    // source, and this is noted rather than guessed at — see the §13 audit row.
    const appList: MetricApp[] = appRows
      .filter((a) => !a.isTemplate)
      .map((a) => ({ id: a.id, pipelineId: a.pipelineId ?? null }));

    // The canonical ledger `audit_events_v2` is raw SQL (no drizzle binding), the same seam
    // readComplianceActivity uses.
    const auditRes = await db.execute(sql`
      SELECT action, outcome FROM audit_events_v2
      WHERE org = ${orgId} AND ts >= ${from.toISOString()}::timestamptz
      LIMIT 50000`);
    const auditRows =
      ((auditRes as unknown as { rows?: Record<string, unknown>[] }).rows ??
        (auditRes as unknown as Record<string, unknown>[])) || [];
    const events: MetricAudit[] = auditRows.map((e) => ({
      action: String(e.action ?? ''),
      outcome: String(e.outcome ?? ''),
    }));

    return assembleProductMetrics(runs, appList, events);
  } catch {
    return null;
  }
}
