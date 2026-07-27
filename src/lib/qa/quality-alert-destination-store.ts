// ─── WHERE QUALITY ALERTS GO — owned by the operator, not by a server env file ────────────────────
//
// Closes G-QUALITY-ALERT-DESTINATION. Alerting worked, but the destination was
// OFFGRID_QUALITY_ALERT_WEBHOOK in `.env.local` on the box, so only someone with shell access could
// point it anywhere — below this repo's bar that every module is manageable in-product.
//
// Own table + idempotent self-migrate (same pattern as roi-settings-store / online-scores) so it
// deploys over SSH with no migration step. The PURE rules (what is a valid destination, and which
// source wins) live in quality-alert-dispatch.ts; this file only reads and writes rows.

import { sql } from 'drizzle-orm';
import { db } from '@/db';

const DEFAULT_ORG = 'default';

let ensurePromise: Promise<void> | null = null;
export async function ensureAlertDestinationSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quality_alert_destination (
        org_id text PRIMARY KEY,
        url text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by text);
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export interface AlertDestinationRecord {
  orgId: string;
  url: string;
  /** Paused rather than deleted — an operator can silence alerts without losing the URL. */
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/** Read this org's configured destination. Never throws — null means "not configured here". */
export async function getAlertDestination(
  orgId: string = DEFAULT_ORG,
): Promise<AlertDestinationRecord | null> {
  try {
    await ensureAlertDestinationSchema();
    const res = await db.execute(sql`
      SELECT org_id, url, enabled, updated_at, updated_by
      FROM quality_alert_destination WHERE org_id = ${orgId};
    `);
    const row = (res.rows as unknown as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      orgId: String(row.org_id),
      url: String(row.url),
      enabled: row.enabled !== false,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      updatedBy: row.updated_by == null ? null : String(row.updated_by),
    };
  } catch {
    return null;
  }
}

/** Create or replace this org's destination. Throws on a real write failure so the route can 500. */
export async function setAlertDestination(
  orgId: string,
  url: string,
  enabled: boolean,
  updatedBy?: string,
): Promise<void> {
  await ensureAlertDestinationSchema();
  await db.execute(sql`
    INSERT INTO quality_alert_destination (org_id, url, enabled, updated_at, updated_by)
    VALUES (${orgId}, ${url}, ${enabled}, now(), ${updatedBy ?? null})
    ON CONFLICT (org_id) DO UPDATE SET
      url = EXCLUDED.url, enabled = EXCLUDED.enabled,
      updated_at = now(), updated_by = EXCLUDED.updated_by;
  `);
}

/** Remove this org's destination. Returns whether a row was actually removed. */
export async function deleteAlertDestination(orgId: string): Promise<boolean> {
  await ensureAlertDestinationSchema();
  const res = await db.execute(sql`
    DELETE FROM quality_alert_destination WHERE org_id = ${orgId} RETURNING org_id;
  `);
  return (res.rows as unknown[]).length > 0;
}
