// Compliance framework ADOPTION state — the org's per-control tracking on top of the pure catalog.
//
// SOLID seam: this is the thin I/O adapter. All the RULES (which frameworks/controls exist, the
// status vocabulary, the coverage math) live in the pure, unit-tested compliance-catalog.ts; this
// file only persists {org, controlId} → status and reads it back. Table is created idempotently on
// first use (CREATE TABLE IF NOT EXISTS, like guardrails_rules / ensureChatSchema) so it deploys
// over SSH with no migration step.
//
// DDL (for SERVER_STATE.md — the parent should record this):
//   CREATE TABLE IF NOT EXISTS compliance_adoption (
//     org_id       text NOT NULL DEFAULT 'default',
//     framework_id text NOT NULL,
//     control_id   text NOT NULL,
//     status       text NOT NULL DEFAULT 'new',   -- new | in-progress | met
//     updated_at   timestamptz NOT NULL DEFAULT now(),
//     PRIMARY KEY (org_id, control_id)
//   );

import {
  CATALOG,
  frameworkProgress,
  getFramework,
  isKnownControl,
  isKnownFramework,
  type ControlTrackStatus,
  type FrameworkId,
  type FrameworkProgress,
} from '@/lib/compliance-catalog';

export interface AdoptionRow {
  frameworkId: FrameworkId;
  controlId: string;
  status: ControlTrackStatus;
  updatedAt: string;
}

export interface AdoptedFramework extends FrameworkProgress {
  adopted: boolean;
}

// ─── Self-creating schema ─────────────────────────────────────────────────────

let ensurePromise: Promise<void> | null = null;
export async function ensureComplianceSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS compliance_adoption (
        org_id text NOT NULL DEFAULT 'default',
        framework_id text NOT NULL,
        control_id text NOT NULL,
        status text NOT NULL DEFAULT 'new',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (org_id, control_id)
      );
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  framework_id: string;
  control_id: string;
  status: string;
  updated_at: Date | string;
}

function rowToAdoption(r: Row): AdoptionRow {
  return {
    frameworkId: r.framework_id as FrameworkId,
    controlId: r.control_id,
    status: (['new', 'in-progress', 'met'].includes(r.status)
      ? r.status
      : 'new') as ControlTrackStatus,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listAdoption(orgId = 'default'): Promise<AdoptionRow[]> {
  await ensureComplianceSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    SELECT framework_id, control_id, status, updated_at
    FROM compliance_adoption WHERE org_id = ${orgId};
  `);
  return (res.rows as unknown as Row[]).map(rowToAdoption);
}

// Status map keyed by controlId — the shape the pure coverage math consumes.
export async function statusMap(orgId = 'default'): Promise<Record<string, ControlTrackStatus>> {
  const rows = await listAdoption(orgId);
  const out: Record<string, ControlTrackStatus> = {};
  for (const r of rows) out[r.controlId] = r.status;
  return out;
}

// Per-framework progress + whether the org has adopted it (any of its controls tracked).
export async function frameworkOverview(orgId = 'default'): Promise<AdoptedFramework[]> {
  const rows = await listAdoption(orgId);
  const statuses: Record<string, ControlTrackStatus> = {};
  const adoptedControls = new Set<string>();
  for (const r of rows) {
    statuses[r.controlId] = r.status;
    adoptedControls.add(r.controlId);
  }
  return CATALOG.map((f) => {
    const p = frameworkProgress(f, statuses);
    const adopted = f.controls.some((c) => adoptedControls.has(c.id));
    return { ...p, adopted };
  });
}

// ─── Writes ────────────────────────────────────────────────────────────────────

// Adopt a whole framework: seed a tracking row (status 'new') for each of its controls that isn't
// already tracked. Idempotent — re-adopting never clobbers existing statuses. Returns the count seeded.
export async function adoptFramework(frameworkId: string, orgId = 'default'): Promise<number> {
  if (!isKnownFramework(frameworkId)) throw new Error('unknown framework');
  const framework = getFramework(frameworkId)!;
  await ensureComplianceSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  let seeded = 0;
  for (const c of framework.controls) {
    const res = await db.execute(sql`
      INSERT INTO compliance_adoption (org_id, framework_id, control_id, status)
      VALUES (${orgId}, ${frameworkId}, ${c.id}, 'new')
      ON CONFLICT (org_id, control_id) DO NOTHING
      RETURNING control_id;
    `);
    seeded += (res.rows as unknown[]).length;
  }
  return seeded;
}

// Drop a framework's tracking entirely (un-adopt). Returns rows removed.
export async function unadoptFramework(frameworkId: string, orgId = 'default'): Promise<number> {
  if (!isKnownFramework(frameworkId)) throw new Error('unknown framework');
  await ensureComplianceSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    DELETE FROM compliance_adoption WHERE org_id = ${orgId} AND framework_id = ${frameworkId}
    RETURNING control_id;
  `);
  return (res.rows as unknown[]).length;
}

// Set one control's status. Upserts so an operator can set status on a control even before the
// framework was formally adopted (the framework_id is resolved from the catalog).
export async function setControlStatus(
  controlId: string,
  status: ControlTrackStatus,
  orgId = 'default',
): Promise<AdoptionRow | null> {
  const found = isKnownControl(controlId);
  if (!found) return null;
  const { findControl } = await import('@/lib/compliance-catalog');
  const frameworkId = findControl(controlId)!.framework;
  await ensureComplianceSchema();
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`
    INSERT INTO compliance_adoption (org_id, framework_id, control_id, status, updated_at)
    VALUES (${orgId}, ${frameworkId}, ${controlId}, ${status}, now())
    ON CONFLICT (org_id, control_id)
    DO UPDATE SET status = ${status}, updated_at = now()
    RETURNING framework_id, control_id, status, updated_at;
  `);
  const rows = res.rows as unknown as Row[];
  return rows.length ? rowToAdoption(rows[0]) : null;
}
