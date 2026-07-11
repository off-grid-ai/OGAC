// DSAR propagation — DEVICE-REPLICA tombstone queue (its OWN store module, NOT store.ts/schema.ts).
//
// Device replicas (mobile/desktop) hold long-term on-device memory that the server can't reach and
// delete synchronously — a device may be offline for days. So instead of silently skipping, an
// erasure records a durable TOMBSTONE row here: a signed "forget subject X" intent that devices pull
// and apply on their next sync, then acknowledge. This is a REAL, recorded propagation request — the
// honest alternative to pretending the device data is gone. Devices poll pending tombstones and PATCH
// them to `acknowledged` once applied.
//
// SOLID: pure-I/O glue (excluded from unit-coverage, verified by integration test + build). The table
// is created idempotently on first use (same ensure* pattern as the other console stores), so the
// deploy needs no migration step.

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

let ensured: Promise<void> | null = null;
export async function ensureErasureTombstoneSchema(): Promise<void> {
  if (ensured) return ensured;
  ensured = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS erasure_tombstones (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        subject text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        requested_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        acknowledged_at timestamptz);
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS erasure_tombstones_org_idx ON erasure_tombstones (org_id);`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS erasure_tombstones_status_idx ON erasure_tombstones (status);`,
    );
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

export interface ErasureTombstone {
  id: string;
  orgId: string;
  subject: string;
  status: 'pending' | 'acknowledged';
  requestedBy: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

interface TombstoneRow {
  id: string;
  org_id: string;
  subject: string;
  status: string;
  requested_by: string;
  created_at: Date | string;
  acknowledged_at: Date | string | null;
}

function toTombstone(r: TombstoneRow): ErasureTombstone {
  return {
    id: r.id,
    orgId: r.org_id,
    subject: r.subject,
    status: r.status === 'acknowledged' ? 'acknowledged' : 'pending',
    requestedBy: r.requested_by,
    createdAt: new Date(r.created_at).toISOString(),
    acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
  };
}

/** Record a durable "forget this subject" tombstone for devices to pull. Idempotency isn't enforced —
 *  a re-run records a fresh intent (audit-friendly). Returns the created row. */
export async function recordTombstone(
  subject: string,
  requestedBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<ErasureTombstone> {
  await ensureErasureTombstoneSchema();
  const id = randomUUID();
  const rows = (await db.execute(sql`
    INSERT INTO erasure_tombstones (id, org_id, subject, status, requested_by)
    VALUES (${id}, ${orgId}, ${subject}, 'pending', ${requestedBy})
    RETURNING *;
  `)) as unknown as { rows: TombstoneRow[] };
  return toTombstone(rows.rows[0]);
}

/** List tombstones for an org (newest first). `onlyPending` filters to unacknowledged intents — the
 *  device-sync poll uses this. */
export async function listTombstones(
  orgId: string = DEFAULT_ORG,
  onlyPending = false,
): Promise<ErasureTombstone[]> {
  await ensureErasureTombstoneSchema();
  const rows = (await db.execute(
    onlyPending
      ? sql`SELECT * FROM erasure_tombstones WHERE org_id = ${orgId} AND status = 'pending' ORDER BY created_at DESC`
      : sql`SELECT * FROM erasure_tombstones WHERE org_id = ${orgId} ORDER BY created_at DESC`,
  )) as unknown as { rows: TombstoneRow[] };
  return rows.rows.map(toTombstone);
}

/** Mark a tombstone acknowledged (a device applied the erasure). Returns the updated row or null. */
export async function acknowledgeTombstone(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<ErasureTombstone | null> {
  await ensureErasureTombstoneSchema();
  const rows = (await db.execute(sql`
    UPDATE erasure_tombstones SET status = 'acknowledged', acknowledged_at = now()
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING *;
  `)) as unknown as { rows: TombstoneRow[] };
  return rows.rows[0] ? toTombstone(rows.rows[0]) : null;
}

/** Count pending tombstones — for the operator readout ("N devices awaiting erasure ack"). */
export async function countPendingTombstones(orgId: string = DEFAULT_ORG): Promise<number> {
  await ensureErasureTombstoneSchema();
  const rows = (await db.execute(
    sql`SELECT count(*)::int AS n FROM erasure_tombstones WHERE org_id = ${orgId} AND status = 'pending'`,
  )) as unknown as { rows: { n: number }[] };
  return rows.rows[0]?.n ?? 0;
}
