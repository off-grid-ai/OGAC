// ─── M4 data governance — the STORE (I/O) for the catalog + classifications + retention + RTBF ──
//
// Thin persistence over data_assets / data_classifications / retention_policies / erasure_requests.
// Every read/write is org-scoped (never leak another tenant). Pure rules live in data-classification.ts,
// data-freshness.ts, data-retention.ts, data-rtbf.ts, data-catalog-seed.ts — this file NEVER
// re-implements them; it maps rows ↔ their pure views and calls the derivations.
//
// Deploy is rsync-only (no migration step over SSH), so the store SELF-PROVISIONS its tables via
// CREATE TABLE IF NOT EXISTS (mirrors ensureAppsSchema / ensurePipelinesSchema). Column names MUST
// match schema.ts exactly.

import { randomUUID } from 'crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  dataAssets,
  dataClassifications,
  retentionPolicies,
  erasureRequests,
  type DataAsset,
  type DataClassificationRow,
  type RetentionPolicyRow,
  type ErasureRequestRow,
} from '@/db/schema';
import {
  makeClassification,
  deriveAssetPosture,
  type Classification,
  type AssetPosture,
} from '@/lib/data-classification';
import { normalizeRetentionAction } from '@/lib/data-retention';

const DEFAULT_ORG = 'default';

// ─── self-migrate (memoized) ────────────────────────────────────────────────────
let ensured: Promise<void> | null = null;
export async function ensureDataGovernanceSchema(): Promise<void> {
  if (ensured) return ensured;
  ensured = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS data_assets (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        source text NOT NULL DEFAULT '',
        connector_id text,
        domain_id text,
        kind text NOT NULL DEFAULT 'table',
        owner text NOT NULL DEFAULT '',
        description text NOT NULL DEFAULT '',
        row_count integer NOT NULL DEFAULT 0,
        freshness_sla_hours integer NOT NULL DEFAULT 0,
        last_refresh_at timestamptz,
        sync_status text NOT NULL DEFAULT 'unknown',
        sync_error text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS data_assets_org_idx ON data_assets (org_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS data_assets_connector_idx ON data_assets (connector_id);`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS data_classifications (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        asset_id text NOT NULL,
        "column" text,
        level text NOT NULL DEFAULT 'internal',
        pii_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS data_classifications_org_idx ON data_classifications (org_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS data_classifications_asset_idx ON data_classifications (asset_id);`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS retention_policies (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        asset_id text NOT NULL,
        retain_days integer NOT NULL DEFAULT 0,
        action text NOT NULL DEFAULT 'delete',
        legal_hold boolean NOT NULL DEFAULT false,
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS retention_policies_org_idx ON retention_policies (org_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS retention_policies_asset_idx ON retention_policies (asset_id);`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS erasure_requests (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        subject text NOT NULL,
        status text NOT NULL DEFAULT 'recorded',
        scope jsonb NOT NULL DEFAULT '{}'::jsonb,
        erased_rows integer NOT NULL DEFAULT 0,
        requested_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz);
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS erasure_requests_org_idx ON erasure_requests (org_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS erasure_requests_subject_idx ON erasure_requests (subject);`);
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

// ─── Data assets (catalog) ────────────────────────────────────────────────────────
export interface CreateAssetInput {
  name: string;
  source?: string;
  connectorId?: string | null;
  domainId?: string | null;
  kind?: string;
  owner?: string;
  description?: string;
  rowCount?: number;
  freshnessSlaHours?: number;
  lastRefreshAt?: Date | null;
  syncStatus?: string;
  syncError?: string;
}
export type UpdateAssetInput = Partial<CreateAssetInput>;

export async function listAssets(orgId: string = DEFAULT_ORG): Promise<DataAsset[]> {
  await ensureDataGovernanceSchema();
  return db
    .select()
    .from(dataAssets)
    .where(eq(dataAssets.orgId, orgId))
    .orderBy(asc(dataAssets.name), asc(dataAssets.id));
}

export async function getAsset(id: string, orgId: string = DEFAULT_ORG): Promise<DataAsset | null> {
  await ensureDataGovernanceSchema();
  const rows = await db
    .select()
    .from(dataAssets)
    .where(and(eq(dataAssets.id, id), eq(dataAssets.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAsset(
  input: CreateAssetInput,
  orgId: string = DEFAULT_ORG,
): Promise<DataAsset> {
  await ensureDataGovernanceSchema();
  const now = new Date();
  const [row] = await db
    .insert(dataAssets)
    .values({
      id: `da_${randomUUID().slice(0, 12)}`,
      orgId,
      name: input.name,
      source: input.source ?? '',
      connectorId: input.connectorId ?? null,
      domainId: input.domainId ?? null,
      kind: input.kind ?? 'table',
      owner: input.owner ?? '',
      description: input.description ?? '',
      rowCount: input.rowCount ?? 0,
      freshnessSlaHours: input.freshnessSlaHours ?? 0,
      lastRefreshAt: input.lastRefreshAt ?? null,
      syncStatus: input.syncStatus ?? 'unknown',
      syncError: input.syncError ?? '',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateAsset(
  id: string,
  patch: UpdateAssetInput,
  orgId: string = DEFAULT_ORG,
): Promise<DataAsset | null> {
  await ensureDataGovernanceSchema();
  const set: Partial<DataAsset> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.source !== undefined) set.source = patch.source;
  if (patch.connectorId !== undefined) set.connectorId = patch.connectorId;
  if (patch.domainId !== undefined) set.domainId = patch.domainId;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.owner !== undefined) set.owner = patch.owner;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.rowCount !== undefined) set.rowCount = patch.rowCount;
  if (patch.freshnessSlaHours !== undefined) set.freshnessSlaHours = patch.freshnessSlaHours;
  if (patch.lastRefreshAt !== undefined) set.lastRefreshAt = patch.lastRefreshAt;
  if (patch.syncStatus !== undefined) set.syncStatus = patch.syncStatus;
  if (patch.syncError !== undefined) set.syncError = patch.syncError;

  const [row] = await db
    .update(dataAssets)
    .set(set)
    .where(and(eq(dataAssets.id, id), eq(dataAssets.orgId, orgId)))
    .returning();
  return row ?? null;
}

// Delete an asset AND its dependent classification + retention rows (org-scoped). Returns true if
// the asset existed. Erasure requests are subject-scoped, not asset-scoped, so they're untouched.
export async function deleteAsset(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureDataGovernanceSchema();
  await db
    .delete(dataClassifications)
    .where(and(eq(dataClassifications.assetId, id), eq(dataClassifications.orgId, orgId)));
  await db
    .delete(retentionPolicies)
    .where(and(eq(retentionPolicies.assetId, id), eq(retentionPolicies.orgId, orgId)));
  const rows = await db
    .delete(dataAssets)
    .where(and(eq(dataAssets.id, id), eq(dataAssets.orgId, orgId)))
    .returning({ id: dataAssets.id });
  return rows.length > 0;
}

// ─── Classifications ──────────────────────────────────────────────────────────────
export function toClassification(r: DataClassificationRow): Classification {
  return makeClassification({ level: r.level, piiTags: r.piiTags, column: r.column });
}

export async function listClassifications(
  assetId: string,
  orgId: string = DEFAULT_ORG,
): Promise<DataClassificationRow[]> {
  await ensureDataGovernanceSchema();
  return db
    .select()
    .from(dataClassifications)
    .where(and(eq(dataClassifications.assetId, assetId), eq(dataClassifications.orgId, orgId)))
    .orderBy(asc(dataClassifications.column), asc(dataClassifications.id));
}

export interface SetClassificationInput {
  column?: string | null;
  level: string;
  piiTags?: string[];
}

// Upsert a classification for (asset, column). column NULL = the asset-level default. One row per
// (asset, column) — a repeat set on the same column updates it rather than duplicating.
export async function setClassification(
  assetId: string,
  input: SetClassificationInput,
  orgId: string = DEFAULT_ORG,
): Promise<DataClassificationRow> {
  await ensureDataGovernanceSchema();
  const c = makeClassification({ level: input.level, piiTags: input.piiTags, column: input.column });
  const existing = await db
    .select()
    .from(dataClassifications)
    .where(
      and(
        eq(dataClassifications.assetId, assetId),
        eq(dataClassifications.orgId, orgId),
        c.column == null
          ? sql`${dataClassifications.column} IS NULL`
          : eq(dataClassifications.column, c.column),
      ),
    )
    .limit(1);

  const now = new Date();
  if (existing[0]) {
    const [row] = await db
      .update(dataClassifications)
      .set({ level: c.level, piiTags: c.piiTags, updatedAt: now })
      .where(eq(dataClassifications.id, existing[0].id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(dataClassifications)
    .values({
      id: `dc_${randomUUID().slice(0, 12)}`,
      orgId,
      assetId,
      column: c.column,
      level: c.level,
      piiTags: c.piiTags,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function deleteClassification(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  await ensureDataGovernanceSchema();
  const rows = await db
    .delete(dataClassifications)
    .where(and(eq(dataClassifications.id, id), eq(dataClassifications.orgId, orgId)))
    .returning({ id: dataClassifications.id });
  return rows.length > 0;
}

// Derive an asset's governance posture from its persisted classifications (pure derivation on real rows).
export async function assetPosture(
  assetId: string,
  orgId: string = DEFAULT_ORG,
): Promise<AssetPosture> {
  const rows = await listClassifications(assetId, orgId);
  return deriveAssetPosture(rows.map(toClassification));
}

// ─── Retention policies ─────────────────────────────────────────────────────────
export interface SetRetentionInput {
  retainDays: number;
  action?: string;
  legalHold?: boolean;
  note?: string;
}

export async function getRetention(
  assetId: string,
  orgId: string = DEFAULT_ORG,
): Promise<RetentionPolicyRow | null> {
  await ensureDataGovernanceSchema();
  const rows = await db
    .select()
    .from(retentionPolicies)
    .where(and(eq(retentionPolicies.assetId, assetId), eq(retentionPolicies.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

// Upsert the single retention policy for an asset.
export async function setRetention(
  assetId: string,
  input: SetRetentionInput,
  orgId: string = DEFAULT_ORG,
): Promise<RetentionPolicyRow> {
  await ensureDataGovernanceSchema();
  const now = new Date();
  const action = normalizeRetentionAction(input.action);
  const retainDays = Number.isFinite(input.retainDays) && input.retainDays > 0
    ? Math.floor(input.retainDays)
    : 0;
  const existing = await getRetention(assetId, orgId);
  if (existing) {
    const [row] = await db
      .update(retentionPolicies)
      .set({ retainDays, action, legalHold: !!input.legalHold, note: input.note ?? '', updatedAt: now })
      .where(eq(retentionPolicies.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(retentionPolicies)
    .values({
      id: `rp_${randomUUID().slice(0, 12)}`,
      orgId,
      assetId,
      retainDays,
      action,
      legalHold: !!input.legalHold,
      note: input.note ?? '',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function deleteRetention(assetId: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureDataGovernanceSchema();
  const rows = await db
    .delete(retentionPolicies)
    .where(and(eq(retentionPolicies.assetId, assetId), eq(retentionPolicies.orgId, orgId)))
    .returning({ id: retentionPolicies.id });
  return rows.length > 0;
}

export async function listRetentionPolicies(
  orgId: string = DEFAULT_ORG,
): Promise<RetentionPolicyRow[]> {
  await ensureDataGovernanceSchema();
  return db.select().from(retentionPolicies).where(eq(retentionPolicies.orgId, orgId));
}

export async function listAllClassifications(
  orgId: string = DEFAULT_ORG,
): Promise<DataClassificationRow[]> {
  await ensureDataGovernanceSchema();
  return db.select().from(dataClassifications).where(eq(dataClassifications.orgId, orgId));
}

// ─── Erasure requests (RTBF records) ──────────────────────────────────────────────
export interface RecordErasureInput {
  subject: string;
  status?: string;
  scope?: Record<string, unknown>;
  erasedRows?: number;
  requestedBy?: string;
  completedAt?: Date | null;
}

export async function recordErasureRequest(
  input: RecordErasureInput,
  orgId: string = DEFAULT_ORG,
): Promise<ErasureRequestRow> {
  await ensureDataGovernanceSchema();
  const [row] = await db
    .insert(erasureRequests)
    .values({
      id: `er_${randomUUID().slice(0, 12)}`,
      orgId,
      subject: input.subject,
      status: input.status ?? 'recorded',
      scope: input.scope ?? {},
      erasedRows: input.erasedRows ?? 0,
      requestedBy: input.requestedBy ?? '',
      createdAt: new Date(),
      completedAt: input.completedAt ?? null,
    })
    .returning();
  return row;
}

export async function listErasureRequests(
  orgId: string = DEFAULT_ORG,
): Promise<ErasureRequestRow[]> {
  await ensureDataGovernanceSchema();
  return db
    .select()
    .from(erasureRequests)
    .where(eq(erasureRequests.orgId, orgId))
    .orderBy(desc(erasureRequests.createdAt));
}

export async function getErasureRequest(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<ErasureRequestRow | null> {
  await ensureDataGovernanceSchema();
  const rows = await db
    .select()
    .from(erasureRequests)
    .where(and(eq(erasureRequests.id, id), eq(erasureRequests.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}
