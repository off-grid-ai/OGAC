import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// ─── When each person last actually used the console ───────────────────────────────────────────────
//
// An access review is only meaningful with a usage signal next to each name. Without it every row
// looks identical and the review gets rubber-stamped — which is the well-known failure mode of these
// artefacts.
//
// The signal comes from the audit ledger, which is the one place that records a real action by a real
// actor. It is deliberately NOT derived from anything softer (a session row, a login timestamp): a
// dormant admin who signed in once is exactly who a review should surface.

/**
 * email (lowercased) → last audited action timestamp, for actors in this org.
 *
 * Absence means NEVER SEEN — the caller must present that as "has never signed in", not as a blank.
 * Throws are the caller's to handle: an unavailable ledger must not be silently reported as
 * "everyone is dormant", which would be a fabricated finding.
 */
export async function lastAuditedActivityByEmail(
  orgId: string = DEFAULT_ORG,
): Promise<Record<string, Date>> {
  const res = await db.execute<{ who: string; last_ts: string }>(sql`
    SELECT lower(COALESCE(NULLIF(actor_label, ''), actor_id)) AS who, MAX(ts) AS last_ts
    FROM audit_events_v2
    WHERE org = ${orgId}
      AND COALESCE(NULLIF(actor_label, ''), actor_id) LIKE '%@%'
    GROUP BY 1;
  `);
  const out: Record<string, Date> = {};
  for (const r of res.rows) {
    if (r.who && r.last_ts) out[r.who] = new Date(r.last_ts);
  }
  return out;
}
