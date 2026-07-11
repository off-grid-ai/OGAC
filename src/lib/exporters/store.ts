// I/O adapter for export_targets — the ONLY place this surface touches the DB + the secret path.
// The pure validation/normalization lives in config.ts; the pure payload builders in the concrete
// exporters. This module: CRUD (org-scoped), an idempotent self-migrate, secret resolution through
// the existing secrets adapter, and honest last-status writes.

import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { exportTargets } from '@/db/schema';
import type { ExportTarget as ExportTargetRow } from '@/db/schema';
import { openBaoSecrets } from '@/lib/adapters/secrets';
import { isRunnable, type NormalizedExportTarget } from './config';
import { catalogFor, type ExporterKind, type ResolvedTarget } from './types';

const DEFAULT_ORG = 'default';

// ─── self-migrate safety net (memoized; mirrors ensureTeamsSchema) ──────────────────────────────────
let ensurePromise: Promise<void> | null = null;
export async function ensureExportTargetsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS export_targets (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        kind text NOT NULL,
        endpoint text NOT NULL DEFAULT '',
        enabled boolean NOT NULL DEFAULT true,
        secret_ref text,
        last_status text,
        last_detail text,
        last_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS export_targets_org_idx ON export_targets (org_id);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── view ───────────────────────────────────────────────────────────────────────────────────────
function iso(v: Date | string | null | undefined): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

export interface ExportTargetView {
  id: string;
  kind: ExporterKind;
  label: string; // catalog label ("Splunk (HEC)")
  target: string; // catalog target ("Splunk HTTP Event Collector")
  endpoint: string;
  enabled: boolean;
  secretRef: string | null;
  runnable: boolean;
  lastStatus: 'ok' | 'fail' | null;
  lastDetail: string | null;
  lastAt: string | null;
}

function toView(row: ExportTargetRow): ExportTargetView {
  const kind = row.kind as ExporterKind;
  const cat = catalogFor(kind);
  const lastStatus = row.lastStatus === 'ok' || row.lastStatus === 'fail' ? row.lastStatus : null;
  return {
    id: row.id,
    kind,
    label: cat?.label ?? kind,
    target: cat?.target ?? '',
    endpoint: row.endpoint ?? '',
    enabled: row.enabled,
    secretRef: row.secretRef ?? null,
    runnable: isRunnable({
      kind,
      endpoint: row.endpoint,
      enabled: row.enabled,
      secretRef: row.secretRef ?? null,
    }),
    lastStatus,
    lastDetail: row.lastDetail ?? null,
    lastAt: iso(row.lastAt),
  };
}

// ─── CRUD (org-scoped) ─────────────────────────────────────────────────────────────────────────
export async function listExportTargets(orgId: string): Promise<ExportTargetView[]> {
  await ensureExportTargetsSchema();
  const rows = await db
    .select()
    .from(exportTargets)
    .where(eq(exportTargets.orgId, orgId || DEFAULT_ORG))
    .orderBy(asc(exportTargets.kind), asc(exportTargets.createdAt));
  return rows.map(toView);
}

export async function getExportTarget(id: string, orgId: string): Promise<ExportTargetView | null> {
  await ensureExportTargetsSchema();
  const rows = await db
    .select()
    .from(exportTargets)
    .where(and(eq(exportTargets.id, id), eq(exportTargets.orgId, orgId || DEFAULT_ORG)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function createExportTarget(
  input: NormalizedExportTarget,
  orgId: string,
): Promise<ExportTargetView> {
  await ensureExportTargetsSchema();
  const id = randomUUID();
  const [row] = await db
    .insert(exportTargets)
    .values({
      id,
      orgId: orgId || DEFAULT_ORG,
      kind: input.kind,
      endpoint: input.endpoint,
      enabled: input.enabled,
      secretRef: input.secretRef,
    })
    .returning();
  return toView(row);
}

export async function updateExportTarget(
  id: string,
  orgId: string,
  input: NormalizedExportTarget,
): Promise<ExportTargetView | null> {
  await ensureExportTargetsSchema();
  const [row] = await db
    .update(exportTargets)
    .set({
      kind: input.kind,
      endpoint: input.endpoint,
      enabled: input.enabled,
      secretRef: input.secretRef,
      updatedAt: new Date(),
    })
    .where(and(eq(exportTargets.id, id), eq(exportTargets.orgId, orgId || DEFAULT_ORG)))
    .returning();
  return row ? toView(row) : null;
}

export async function deleteExportTarget(id: string, orgId: string): Promise<boolean> {
  await ensureExportTargetsSchema();
  const rows = await db
    .delete(exportTargets)
    .where(and(eq(exportTargets.id, id), eq(exportTargets.orgId, orgId || DEFAULT_ORG)))
    .returning({ id: exportTargets.id });
  return rows.length > 0;
}

// Persist the HONEST result of a real test()/export() call. Never fabricated.
export async function recordExportStatus(
  id: string,
  orgId: string,
  status: 'ok' | 'fail',
  detail: string,
): Promise<void> {
  await ensureExportTargetsSchema();
  await db
    .update(exportTargets)
    .set({ lastStatus: status, lastDetail: detail.slice(0, 500), lastAt: new Date(), updatedAt: new Date() })
    .where(and(eq(exportTargets.id, id), eq(exportTargets.orgId, orgId || DEFAULT_ORG)));
}

// Resolve a stored target's config into a ResolvedTarget by reading its token from the secret path.
// The token NEVER leaves this function's return; it is handed straight to the exporter's fetch.
// Returns null if the target isn't found. `secret` is null when there's no secretRef or it's unset.
export async function resolveTarget(id: string, orgId: string): Promise<ResolvedTarget | null> {
  const view = await getExportTarget(id, orgId);
  if (!view) return null;
  let secret: string | null = null;
  if (view.secretRef) {
    try {
      secret = (await openBaoSecrets.get(view.secretRef)) ?? null;
    } catch {
      secret = null;
    }
  }
  return { id: view.id, kind: view.kind, endpoint: view.endpoint, secret };
}
