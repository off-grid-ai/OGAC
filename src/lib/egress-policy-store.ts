// Cloud egress-DLP policy persistence — console-owned, per-org. Thin I/O ADAPTER over `@/db`; ALL
// decision logic lives in the pure `egress-dlp.ts`. Self-contained table, created idempotently on
// first use (mirrors guardrails-rules.ts / ensureChatSchema) so it deploys over SSH with no migration
// step. The policy is per-tenant (keyed by org id); an absent row reads as the secure DEFAULT
// (enabled, mask) via the pure normalizer — protection is default-ON.

import {
  DEFAULT_EGRESS_DLP_POLICY,
  type EgressDlpPolicy,
  type EgressStrictness,
  normalizeEgressPolicy,
} from './egress-dlp';

const DEFAULT_ORG = 'default';

// Lazily imported so a caller that only needs the pure policy shape never drags in the DB runtime.
let ensurePromise: Promise<void> | null = null;
export async function ensureEgressPolicySchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS egress_dlp_policy (
        org_id text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT true,
        strictness text NOT NULL DEFAULT 'mask',
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by text NOT NULL DEFAULT '');
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface PolicyRow {
  enabled: boolean;
  strictness: string;
  updated_at: Date | string;
  updated_by: string;
}

export interface StoredEgressPolicy extends EgressDlpPolicy {
  updatedAt: string;
  updatedBy: string;
}

/**
 * Read the org's egress-DLP policy. An absent row (never configured) returns the secure DEFAULT — the
 * pure normalizer guarantees an absent/garbage value can never read as "off". Best-effort: a DB
 * hiccup degrades to the DEFAULT so the enforcement seam always has a policy (never a thrown request).
 */
export async function getEgressPolicy(orgId: string = DEFAULT_ORG): Promise<StoredEgressPolicy> {
  try {
    await ensureEgressPolicySchema();
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT enabled, strictness, updated_at, updated_by
      FROM egress_dlp_policy WHERE org_id = ${orgId} LIMIT 1;
    `);
    const rows = res.rows as unknown as PolicyRow[];
    if (!rows.length) {
      return { ...DEFAULT_EGRESS_DLP_POLICY, updatedAt: '', updatedBy: '' };
    }
    const row = rows[0];
    const policy = normalizeEgressPolicy({ enabled: row.enabled, strictness: row.strictness });
    return {
      ...policy,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      updatedBy: row.updated_by ?? '',
    };
  } catch {
    return { ...DEFAULT_EGRESS_DLP_POLICY, updatedAt: '', updatedBy: '' };
  }
}

/** Upsert the org's egress-DLP policy (admin-only; validated + normalized at the route). Per-tenant. */
export async function setEgressPolicy(
  patch: { enabled: boolean; strictness: EgressStrictness },
  updatedBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<StoredEgressPolicy> {
  await ensureEgressPolicySchema();
  const policy = normalizeEgressPolicy(patch);
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    INSERT INTO egress_dlp_policy (org_id, enabled, strictness, updated_by, updated_at)
    VALUES (${orgId}, ${policy.enabled}, ${policy.strictness}, ${updatedBy}, now())
    ON CONFLICT (org_id) DO UPDATE
      SET enabled = ${policy.enabled}, strictness = ${policy.strictness},
          updated_by = ${updatedBy}, updated_at = now();
  `);
  return getEgressPolicy(orgId);
}

// ─── recent egress-DLP decisions (read the canonical audit ledger) ────────────────────────────────

export interface EgressDecisionRow {
  ts: string;
  actor: string;
  action: string;
  resource: string;
  model: string | null;
  outcome: string;
}

/**
 * The most recent egress-DLP decisions for an org, read from the canonical audit ledger
 * (`audit_events_v2`, where the enforcement seam records `gateway.egress.dlp`). Best-effort: a
 * missing table / read error yields an empty list, never a 500. This backs the "last decisions"
 * panel on the governance surface (masked / blocked / unprotected egress, provable after the fact).
 */
export async function listEgressDecisions(
  orgId: string = DEFAULT_ORG,
  limit = 25,
): Promise<EgressDecisionRow[]> {
  try {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT ts, actor_id, actor_label, action, resource, model, outcome
      FROM audit_events_v2
      WHERE org = ${orgId} AND action = 'gateway.egress.dlp'
      ORDER BY ts DESC
      LIMIT ${limit};
    `);
    const rows =
      (res as unknown as { rows?: Record<string, unknown>[] }).rows ??
      (res as unknown as Record<string, unknown>[]);
    return (rows as Record<string, unknown>[]).map((r) => ({
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts ?? ''),
      actor: String(r.actor_label || r.actor_id || 'unknown'),
      action: String(r.action ?? ''),
      resource: String(r.resource ?? ''),
      model: r.model == null ? null : String(r.model),
      outcome: String(r.outcome ?? ''),
    }));
  } catch {
    return [];
  }
}
