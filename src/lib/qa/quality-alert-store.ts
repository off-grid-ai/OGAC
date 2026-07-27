// Persistence for what we have already told an operator about (I/O only — the decision is the pure
// planQualityAlerts). Self-creating table, same pattern as online-scores, so it deploys with no
// migration step.
//
// Without this memory an alerter re-fires on every evaluation while quality stays bad, which trains
// people to ignore it. The table IS the anti-fatigue mechanism.

import type { QualityAlertState } from '@/lib/qa/quality-alert-plan';

let ensurePromise: Promise<void> | null = null;

export async function ensureQualityAlertSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quality_alert_state (
        org_id text NOT NULL DEFAULT 'default',
        subject_id text NOT NULL,
        status text NOT NULL DEFAULT 'clear',
        since timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (org_id, subject_id));
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

/** Read what we already know per subject. Never throws — an empty list degrades to "never told". */
export async function listAlertState(orgId = 'default'): Promise<QualityAlertState[]> {
  try {
    await ensureQualityAlertSchema();
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT subject_id, status, since FROM quality_alert_state WHERE org_id = ${orgId};
    `);
    return (res.rows as unknown as Record<string, unknown>[]).map((r) => ({
      subjectId: String(r.subject_id),
      status: r.status === 'regressed' ? 'regressed' : 'clear',
      since: r.since instanceof Date ? r.since.toISOString() : String(r.since),
    }));
  } catch {
    return [];
  }
}

/**
 * Write back the states the planner produced. NEVER throws.
 *
 * Returns whether the write landed, because the caller must NOT treat an alert as delivered-and-
 * remembered if the memory failed — better to risk a duplicate alert than to go silent forever on a
 * regression we think we already reported.
 */
export async function saveAlertState(
  orgId: string,
  states: readonly QualityAlertState[],
): Promise<boolean> {
  if (states.length === 0) return true;
  try {
    await ensureQualityAlertSchema();
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    for (const s of states) {
      await db.execute(sql`
        INSERT INTO quality_alert_state (org_id, subject_id, status, since)
        VALUES (${orgId}, ${s.subjectId}, ${s.status}, ${s.since})
        ON CONFLICT (org_id, subject_id) DO UPDATE SET status = EXCLUDED.status, since = EXCLUDED.since;
      `);
    }
    return true;
  } catch {
    return false;
  }
}
