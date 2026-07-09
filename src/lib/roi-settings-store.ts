// ─── ROI settings store — thin I/O over an OWN table (NOT schema.ts) ──────────────────────────────
//
// Persists the two ESTIMATES that drive Surfaced ROI:
//   • an ORG default (minutesSavedPerRun + loadedCostPerHour), one row per org;
//   • a PER-APP override, one row per app (either field nullable ⇒ "inherit the org default").
//
// It deliberately owns its own `roi_settings` table via an idempotent CREATE TABLE IF NOT EXISTS
// self-migrate (mirrors ensureTeamsSchema / ensureAppsSchema) so it deploys over SSH ahead of any
// SQL migration and never touches src/db/schema.ts (owned by another agent). The PURE precedence
// (app override → org default → hard default) lives in roi.ts:resolveRoiSettings — this file only
// reads/writes the raw rows.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { RoiSettingsOverride } from '@/lib/roi';

const DEFAULT_ORG = 'default';
// Sentinel app id for the ORG-DEFAULT row (a per-app row can never collide with this).
const ORG_DEFAULT_APP = '__org_default__';

// ─── self-migrate safety net (memoized) ───────────────────────────────────────────────────────────
let ensurePromise: Promise<void> | null = null;
export async function ensureRoiSettingsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS roi_settings (
        org_id text NOT NULL DEFAULT 'default',
        app_id text NOT NULL,
        minutes_saved_per_run double precision,
        loaded_cost_per_hour double precision,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (org_id, app_id));
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS roi_settings_org_idx ON roi_settings (org_id);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// A raw settings row (either field null ⇒ "not set ⇒ inherit").
type Row = {
  minutes_saved_per_run: number | null;
  loaded_cost_per_hour: number | null;
};

function toOverride(row: Row | undefined | null): RoiSettingsOverride | null {
  if (!row) return null;
  return {
    minutesSavedPerRun: row.minutes_saved_per_run,
    loadedCostPerHour: row.loaded_cost_per_hour,
  };
}

async function readRow(orgId: string, appId: string): Promise<RoiSettingsOverride | null> {
  await ensureRoiSettingsSchema();
  const res = await db.execute<Row>(sql`
    SELECT minutes_saved_per_run, loaded_cost_per_hour
    FROM roi_settings WHERE org_id = ${orgId} AND app_id = ${appId} LIMIT 1;
  `);
  const rows = (res as unknown as { rows?: Row[] }).rows ?? (res as unknown as Row[]);
  return toOverride(Array.isArray(rows) ? rows[0] : undefined);
}

async function writeRow(
  orgId: string,
  appId: string,
  patch: RoiSettingsOverride,
): Promise<void> {
  await ensureRoiSettingsSchema();
  const mins = patch.minutesSavedPerRun ?? null;
  const rate = patch.loadedCostPerHour ?? null;
  await db.execute(sql`
    INSERT INTO roi_settings (org_id, app_id, minutes_saved_per_run, loaded_cost_per_hour, updated_at)
    VALUES (${orgId}, ${appId}, ${mins}, ${rate}, now())
    ON CONFLICT (org_id, app_id) DO UPDATE
      SET minutes_saved_per_run = ${mins},
          loaded_cost_per_hour = ${rate},
          updated_at = now();
  `);
}

// ─── org default ──────────────────────────────────────────────────────────────────────────────────
/** The org-wide default estimates (null when never set ⇒ hard defaults apply). */
export function getOrgRoiDefault(orgId: string = DEFAULT_ORG): Promise<RoiSettingsOverride | null> {
  return readRow(orgId, ORG_DEFAULT_APP);
}

/** Set the org-wide default estimates. */
export function setOrgRoiDefault(
  patch: RoiSettingsOverride,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  return writeRow(orgId, ORG_DEFAULT_APP, patch);
}

// ─── per-app override ───────────────────────────────────────────────────────────────────────────
/** One app's override (null when never set ⇒ inherit the org default). */
export function getAppRoiOverride(
  appId: string,
  orgId: string = DEFAULT_ORG,
): Promise<RoiSettingsOverride | null> {
  return readRow(orgId, appId);
}

/** Set one app's override. Passing a null field clears it (⇒ inherit). */
export function setAppRoiOverride(
  appId: string,
  patch: RoiSettingsOverride,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  return writeRow(orgId, appId, patch);
}

/** Every per-app override for an org, keyed by appId — one query for the rollup. */
export async function listAppRoiOverrides(
  orgId: string = DEFAULT_ORG,
): Promise<Map<string, RoiSettingsOverride>> {
  await ensureRoiSettingsSchema();
  const res = await db.execute<Row & { app_id: string }>(sql`
    SELECT app_id, minutes_saved_per_run, loaded_cost_per_hour
    FROM roi_settings WHERE org_id = ${orgId} AND app_id <> ${ORG_DEFAULT_APP};
  `);
  const rows =
    (res as unknown as { rows?: (Row & { app_id: string })[] }).rows ??
    (res as unknown as (Row & { app_id: string })[]);
  const out = new Map<string, RoiSettingsOverride>();
  for (const r of Array.isArray(rows) ? rows : []) {
    out.set(r.app_id, {
      minutesSavedPerRun: r.minutes_saved_per_run,
      loadedCostPerHour: r.loaded_cost_per_hour,
    });
  }
  return out;
}
