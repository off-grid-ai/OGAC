// ─── Evidence posture — thin I/O ───────────────────────────────────────────────────────────────────
//
// Counts only. Every rule about what the numbers MEAN lives in evidence-posture.ts, and a failed read
// yields `undefined` for that count so the pure layer can report "unreadable" rather than zero.
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { type EvidenceCounts } from '@/lib/evidence-posture';

async function count(q: ReturnType<typeof sql>): Promise<number | undefined> {
  try {
    const res = await db.execute(q);
    const rows =
      ((res as unknown as { rows?: Record<string, unknown>[] }).rows ??
        (res as unknown as Record<string, unknown>[])) || [];
    const n = Number(rows[0]?.n ?? NaN);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    // Undefined, NOT 0 — a query that failed must not be reported as an empty ledger.
    return undefined;
  }
}

/** Read the four evidence counts for one org. Best-effort per count; one failure never hides the rest. */
export async function readEvidenceCounts(orgId: string): Promise<Partial<EvidenceCounts>> {
  const [audit, refused, signed, exporters] = await Promise.all([
    count(sql`SELECT count(*)::int AS n FROM audit_events_v2 WHERE org = ${orgId}`),
    count(
      sql`SELECT count(*)::int AS n FROM audit_events_v2
          WHERE org = ${orgId} AND outcome IN ('blocked', 'denied')`,
    ),
    // Column and table names VERIFIED against the live schema rather than guessed. My first attempt used
    // app_runs.signature and evidence_exporters — neither exists — and both cards correctly reported
    // "could not read" instead of silently showing 0, which is exactly what that path is for.
    count(
      sql`SELECT count(*)::int AS n FROM app_runs
          WHERE org_id = ${orgId} AND provenance IS NOT NULL`,
    ),
    count(sql`SELECT count(*)::int AS n FROM export_targets WHERE org_id = ${orgId}`),
  ]);
  return { audit, refused, signed, exporters };
}
