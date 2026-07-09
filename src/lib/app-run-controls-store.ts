// ─── App run controls store — thin I/O over the `app_run_controls` table ─────────────────────────
//
// Storage adapter for the per-app SHADOW MODE + BLAST-RADIUS dials. SOLID split: the PURE rules
// (evaluateBlastRadius / resolveRunMode / shadow-intercept / normalizeControls) live in
// app-run-controls.ts; this file is the I/O only — self-migrating table, org-scoped CRUD, and the
// live USAGE counters (runs-today from app_runs, spend-today from the audit ledger) that feed the
// pure cap decision. Absent controls row ⇒ DEFAULT_CONTROLS (the additive guarantee).
//
// Deploy is rsync-only (no migration step over SSH), so the store self-provisions the table +
// post-hoc columns (CREATE/ALTER … IF NOT EXISTS). Column names MUST match schema.ts exactly.

import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appRunControls, appRuns } from '@/db/schema';
import {
  type BlastRadiusControls,
  type BlastRadiusUsage,
  DEFAULT_CONTROLS,
  normalizeControls,
} from '@/lib/app-run-controls';

const DEFAULT_ORG = 'default';

// ─── self-migrate safety net (memoized; mirrors ensureAppsSchema) ──────────────────────────────────
let ensure: Promise<void> | null = null;
export async function ensureAppRunControlsSchema(): Promise<void> {
  if (ensure) return ensure;
  ensure = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_run_controls (
        app_id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        enabled boolean NOT NULL DEFAULT true,
        shadow_default boolean NOT NULL DEFAULT false,
        max_runs_per_day integer,
        spend_cap_usd double precision,
        spend_cap_scope text NOT NULL DEFAULT 'day',
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS app_run_controls_org_idx ON app_run_controls (org_id);`);
  })().catch((e) => {
    ensure = null;
    throw e;
  });
  return ensure;
}

// ─── Row ↔ BlastRadiusControls mapping ─────────────────────────────────────────
function toControls(row: typeof appRunControls.$inferSelect): BlastRadiusControls {
  return normalizeControls({
    enabled: row.enabled,
    shadowDefault: row.shadowDefault,
    maxRunsPerDay: row.maxRunsPerDay ?? null,
    spendCapUsd: row.spendCapUsd ?? null,
    spendCapScope: row.spendCapScope === 'run' ? 'run' : 'day',
  });
}

// ─── getControls — the app's controls, or DEFAULT_CONTROLS when no row exists ──────────────────────
// Never throws on an absent table/row: returns the permissive default so a run behaves exactly as
// before this feature existed (additive). A DB error propagates only from ensure (the caller wraps).
export async function getControls(appId: string, orgId: string): Promise<BlastRadiusControls> {
  await ensureAppRunControlsSchema();
  const [row] = await db
    .select()
    .from(appRunControls)
    .where(and(eq(appRunControls.appId, appId), eq(appRunControls.orgId, orgId || DEFAULT_ORG)))
    .limit(1);
  return row ? toControls(row) : { ...DEFAULT_CONTROLS };
}

// ─── upsertControls — set/patch the controls, org-scoped, validated by the pure normalizer ─────────
export async function upsertControls(
  appId: string,
  orgId: string,
  patch: Partial<BlastRadiusControls>,
): Promise<BlastRadiusControls> {
  await ensureAppRunControlsSchema();
  const org = orgId || DEFAULT_ORG;
  // Merge onto the current (or default) so a partial patch keeps the untouched dials.
  const current = await getControls(appId, org);
  const next = normalizeControls({ ...current, ...patch });
  await db
    .insert(appRunControls)
    .values({
      appId,
      orgId: org,
      enabled: next.enabled,
      shadowDefault: next.shadowDefault ?? false,
      maxRunsPerDay: next.maxRunsPerDay ?? null,
      spendCapUsd: next.spendCapUsd ?? null,
      spendCapScope: next.spendCapScope ?? 'day',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appRunControls.appId,
      set: {
        enabled: next.enabled,
        shadowDefault: next.shadowDefault ?? false,
        maxRunsPerDay: next.maxRunsPerDay ?? null,
        spendCapUsd: next.spendCapUsd ?? null,
        spendCapScope: next.spendCapScope ?? 'day',
        updatedAt: new Date(),
      },
    });
  return next;
}

// ─── deleteControls — remove the row → the app reverts to DEFAULT_CONTROLS ─────────────────────────
export async function deleteControls(appId: string, orgId: string): Promise<void> {
  await ensureAppRunControlsSchema();
  await db
    .delete(appRunControls)
    .where(and(eq(appRunControls.appId, appId), eq(appRunControls.orgId, orgId || DEFAULT_ORG)));
}

// ─── usageFor — the live counters the cap decision is evaluated against ────────────────────────────
// runsToday  = COUNT(app_runs) for this app+org since UTC midnight.
// spentToday = SUM(cost_usd) from the audit ledger (audit_events_v2) for this app's runs today. The
//              app.run audit event carries the run's cost attribution; we scope by resource LIKE
//              'app:<id>%' + today's window. Best-effort — an absent ledger yields 0 (never blocks
//              on missing data; a real spend cap only bites when real spend is recorded).
export async function usageFor(
  appId: string,
  orgId: string,
  incomingRunCostUsd = 0,
): Promise<BlastRadiusUsage> {
  const org = orgId || DEFAULT_ORG;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  let runsToday = 0;
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(appRuns)
      .where(
        and(
          eq(appRuns.appId, appId),
          eq(appRuns.orgId, org),
          gte(appRuns.startedAt, startOfDay),
        ),
      );
    runsToday = Number(rows[0]?.n ?? 0);
  } catch {
    /* absent table — treat as 0 */
  }

  let spentTodayUsd = 0;
  try {
    const res = await db.execute(sql`
      SELECT COALESCE(SUM(cost_usd), 0) AS spent
      FROM audit_events_v2
      WHERE org = ${org}
        AND action = 'app.run'
        AND resource LIKE ${'app:' + appId + '%'}
        AND ts >= ${startOfDay.toISOString()}::timestamptz`);
    const list =
      (res as unknown as { rows?: Record<string, unknown>[] }).rows ??
      (res as unknown as Record<string, unknown>[]);
    const raw = list?.[0]?.spent;
    const n = typeof raw === 'number' ? raw : Number(raw);
    spentTodayUsd = Number.isFinite(n) ? n : 0;
  } catch {
    /* absent ledger — treat as 0 */
  }

  return { runsToday, spentTodayUsd, incomingRunCostUsd: Math.max(0, incomingRunCostUsd) };
}
