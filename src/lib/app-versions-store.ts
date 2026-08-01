// ─── App version history — append-only snapshots, and the way back ─────────────────────────────────
//
// ROADMAP §10 Flow 7 steps 5 and 7 ("compares with previous versions", "rolls out or rolls back") and
// §11's "human control … reversal". Pipelines had this; apps did not, and an app run is what an
// operator is usually investigating.
//
// Modelled deliberately on `pipelines.ts`'s version writer so both entities behave identically:
// append-only, a full snapshot per version, a note and an author. The store is I/O; the decisions —
// what changed, whether a change is worth a version — live in the pure `app-version-diff.ts`.

import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { appVersions } from '@/db/schema';
import {
  type AppSnapshot,
  type AppChange,
  describeChanges,
  diffAppVersions,
  hasMeaningfulChange,
} from '@/lib/app-version-diff';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Self-migrating, like the other stores here, so a deploy over SSH needs no migration step.
let ensurePromise: Promise<void> | null = null;
export async function ensureAppVersionsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_versions (
        id text PRIMARY KEY,
        app_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        version integer NOT NULL,
        snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by text NOT NULL DEFAULT '');
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS app_versions_app_idx ON app_versions (app_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS app_versions_org_idx ON app_versions (org_id);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export interface AppVersionRow {
  id: string;
  version: number;
  note: string;
  createdAt: string;
  createdBy: string;
  snapshot: AppSnapshot;
}

/** History for one app, newest first. Org-scoped — a version is as tenant-bound as its app. */
export async function listAppVersions(
  appId: string,
  orgId: string = DEFAULT_ORG,
): Promise<AppVersionRow[]> {
  await ensureAppVersionsSchema();
  const rows = await db
    .select()
    .from(appVersions)
    .where(and(eq(appVersions.appId, appId), eq(appVersions.orgId, orgId)))
    .orderBy(desc(appVersions.version));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
    snapshot: (r.snapshot ?? {}) as AppSnapshot,
  }));
}

export async function getAppVersion(
  appId: string,
  version: number,
  orgId: string = DEFAULT_ORG,
): Promise<AppVersionRow | null> {
  const all = await listAppVersions(appId, orgId);
  return all.find((v) => v.version === version) ?? null;
}

/**
 * Freeze a snapshot. Returns the version number written, or null when the spec is unchanged in any way
 * that matters — re-saving an app with no functional edit must not inflate its history, the same rule
 * the artifact versioner uses.
 *
 * `note` is the author's own words when they have any; otherwise the diff describes itself, so history
 * reads as sentences ("Instructions rewritten on Draft Notice") rather than as a column of timestamps.
 */
export async function recordAppVersion(
  appId: string,
  orgId: string,
  snapshot: AppSnapshot,
  by: string,
  note?: string,
): Promise<number | null> {
  await ensureAppVersionsSchema();
  const scopedOrg = orgId || DEFAULT_ORG;
  const history = await listAppVersions(appId, scopedOrg);
  const latest = history[0];
  if (latest && !hasMeaningfulChange(latest.snapshot, snapshot)) return null;

  const version = (latest?.version ?? 0) + 1;
  const changes: AppChange[] = latest ? diffAppVersions(latest.snapshot, snapshot) : [];
  await db
    .insert(appVersions)
    .values({
      id: `apv_${randomUUID().slice(0, 12)}`,
      appId,
      orgId: scopedOrg,
      version,
      snapshot: snapshot as unknown as Record<string, unknown>,
      note: (note?.trim() || describeChanges(changes, !latest)).slice(0, 200),
      createdBy: by,
    })
    .onConflictDoNothing({ target: appVersions.id });
  return version;
}

/** Delete an app's history — called when the app itself is deleted, so no orphan snapshots remain. */
export async function deleteAppVersions(appId: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensureAppVersionsSchema();
  await db
    .delete(appVersions)
    .where(and(eq(appVersions.appId, appId), eq(appVersions.orgId, orgId)));
}
