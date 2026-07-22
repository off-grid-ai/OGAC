// OPA decision-log LEDGER store — the durable, org-scoped, tamper-evident record of authz decisions.
//
// This is the SINK for OPA's decision-log plugin: when OPA is configured to ship decisions to the
// console ingest endpoint, each event is normalized (opa-audit.ts) and persisted here, so the
// compliance surface has a real, cross-restart history (unlike the in-process ring in
// policy-decision-log.ts, which is per-node and volatile).
//
// SOLID: all shaping/filtering/aggregation is the PURE opa-audit module; this file is the thin DB
// seam only — a self-migrating table (rsync-deploy has no migration step) + org-scoped
// insert/list/get/count/delete. Rows are keyed by (org_id, decision_id) so re-delivered events
// (OPA retries uploads) upsert instead of duplicating — an append-only ledger with idempotent writes.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  type DecisionAggregate,
  type DecisionQuery,
  type OpaDecisionEvent,
  aggregateDecisions,
  filterDecisions,
} from '@/lib/opa-audit';

const DEFAULT_ORG = 'default';

// ─── self-migrate (memoized) ────────────────────────────────────────────────────
let ensure: Promise<void> | null = null;
export async function ensureOpaDecisionLogSchema(): Promise<void> {
  if (ensure) return ensure;
  ensure = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS opa_decision_logs (
        id bigserial PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        decision_id text NOT NULL,
        path text NOT NULL DEFAULT 'offgrid/authz',
        allow boolean NOT NULL DEFAULT false,
        reason text NOT NULL DEFAULT '',
        engine text NOT NULL DEFAULT 'opa',
        actor text NOT NULL DEFAULT '',
        decided_at timestamptz,
        input jsonb,
        result jsonb,
        labels jsonb,
        received_at timestamptz NOT NULL DEFAULT now());
    `);
    // Idempotent ledger: OPA retries uploads, so (org, decision_id) must not duplicate.
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS opa_decision_logs_org_decision_idx ON opa_decision_logs (org_id, decision_id);`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS opa_decision_logs_org_received_idx ON opa_decision_logs (org_id, received_at DESC);`,
    );
  })().catch((e) => {
    ensure = null;
    throw e;
  });
  return ensure;
}

interface Row {
  decision_id: string;
  path: string;
  allow: boolean;
  reason: string;
  engine: string;
  actor: string;
  decided_at: string | Date | null;
  input: unknown;
  result: unknown;
  labels: unknown;
}

function toEvent(r: Row): OpaDecisionEvent {
  const ts = r.decided_at ? new Date(r.decided_at) : null;
  return {
    decisionId: r.decision_id,
    path: r.path,
    allow: r.allow,
    reason: r.reason,
    engine: r.engine,
    actor: r.actor,
    timestamp: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : '',
    input: (r.input as Record<string, unknown> | null) ?? null,
    result: r.result ?? null,
    labels: (r.labels as Record<string, string> | null) ?? {},
  };
}

// Persist a batch of normalized decision events for an org. Idempotent per (org, decisionId): a
// re-delivered event refreshes the row rather than duplicating. Returns the number of rows written.
export async function persistDecisions(
  events: readonly OpaDecisionEvent[],
  orgId: string = DEFAULT_ORG,
): Promise<number> {
  await ensureOpaDecisionLogSchema();
  const org = orgId || DEFAULT_ORG;
  let written = 0;
  for (const e of events) {
    const decidedAt = e.timestamp ? new Date(e.timestamp) : null;
    await db.execute(sql`
      INSERT INTO opa_decision_logs
        (org_id, decision_id, path, allow, reason, engine, actor, decided_at, input, result, labels)
      VALUES (
        ${org}, ${e.decisionId}, ${e.path}, ${e.allow}, ${e.reason}, ${e.engine}, ${e.actor},
        ${decidedAt ? decidedAt.toISOString() : null},
        ${e.input ? JSON.stringify(e.input) : null}::jsonb,
        ${e.result !== null && e.result !== undefined ? JSON.stringify(e.result) : null}::jsonb,
        ${JSON.stringify(e.labels ?? {})}::jsonb)
      ON CONFLICT (org_id, decision_id) DO UPDATE SET
        path = EXCLUDED.path, allow = EXCLUDED.allow, reason = EXCLUDED.reason,
        engine = EXCLUDED.engine, actor = EXCLUDED.actor, decided_at = EXCLUDED.decided_at,
        input = EXCLUDED.input, result = EXCLUDED.result, labels = EXCLUDED.labels;
    `);
    written += 1;
  }
  return written;
}

// Read persisted decisions for an org, newest-first, then apply the pure query filter. The DB read
// caps generously (MAX over-fetch) and the pure filterDecisions applies decision/path/since/limit —
// one filtering rule (DRY), shared with any in-memory source.
export async function listDecisions(
  query: DecisionQuery,
  orgId: string = DEFAULT_ORG,
): Promise<OpaDecisionEvent[]> {
  await ensureOpaDecisionLogSchema();
  const org = orgId || DEFAULT_ORG;
  const res = await db.execute(sql`
    SELECT decision_id, path, allow, reason, engine, actor, decided_at, input, result, labels
    FROM opa_decision_logs WHERE org_id = ${org}
    ORDER BY received_at DESC LIMIT 1000;
  `);
  const events = (res.rows as unknown as Row[]).map(toEvent);
  return filterDecisions(events, query);
}

// One decision's full record by decision id (the detail view). Null when unknown for this org.
export async function getDecision(
  decisionId: string,
  orgId: string = DEFAULT_ORG,
): Promise<OpaDecisionEvent | null> {
  await ensureOpaDecisionLogSchema();
  const org = orgId || DEFAULT_ORG;
  const res = await db.execute(sql`
    SELECT decision_id, path, allow, reason, engine, actor, decided_at, input, result, labels
    FROM opa_decision_logs WHERE org_id = ${org} AND decision_id = ${decisionId} LIMIT 1;
  `);
  const row = (res.rows as unknown as Row[])[0];
  return row ? toEvent(row) : null;
}

// Aggregate counts over ALL persisted decisions for an org (the compliance summary band). Reuses the
// pure aggregator (DRY).
export async function aggregateForOrg(orgId: string = DEFAULT_ORG): Promise<DecisionAggregate> {
  await ensureOpaDecisionLogSchema();
  const org = orgId || DEFAULT_ORG;
  const res = await db.execute(sql`
    SELECT decision_id, path, allow, reason, engine, actor, decided_at, input, result, labels
    FROM opa_decision_logs WHERE org_id = ${org} ORDER BY received_at DESC LIMIT 1000;
  `);
  return aggregateDecisions((res.rows as unknown as Row[]).map(toEvent));
}

// Delete one decision from the ledger (governed purge — e.g. retention/GDPR erasure). Returns true
// when a row was removed. Mutations are audited by the route.
export async function deleteDecision(
  decisionId: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  await ensureOpaDecisionLogSchema();
  const org = orgId || DEFAULT_ORG;
  const res = await db.execute(sql`
    DELETE FROM opa_decision_logs WHERE org_id = ${org} AND decision_id = ${decisionId} RETURNING decision_id;
  `);
  return (res.rows as unknown[]).length > 0;
}
