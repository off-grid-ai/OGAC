// ─── Gateway REGISTRY store + live-health adapter (Gateways × Pipelines, P1) ──────────────────────
//
// The impure seam behind the pure rules in gateways-policy.ts. This file does the I/O:
//   • CRUD over the `gateways` table (drizzle query-builder; org-scoped via `orgId`).
//   • an idempotent `ensure*` self-migrate so the module deploys over SSH before the SQL migration
//     lands (mirrors ensureGuardrailRulesSchema / ensureEvalDefsSchema) — CREATE TABLE IF NOT EXISTS.
//   • merging each registry row with its LIVE health, reusing the EXISTING signals (DRY — no
//     re-implementation of provider config or aggregator probing):
//       - on-prem gateways → the aggregator's GET /nodes (via gateway.ts) — any node up ⇒ reachable.
//       - cloud gateways   → cloud-providers.ts (configured = base URL+key in env) + a /models probe.
//
// The correctness (kind→egressClass, available = enabled+configured+reachable, status) lives in the
// PURE gateways-policy.ts; this file only gathers the facts and calls `mergeGatewayHealth`. It can
// therefore NEVER fake availability — an unconfigured or unreachable gateway is reported honestly.
import { randomUUID } from 'crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { gateways } from '@/db/schema';
import type { Gateway as GatewayRowDb } from '@/db/schema';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import { cloudProviderStatuses } from '@/lib/cloud-providers';
import {
  type EgressClass,
  type GatewayHealthSignal,
  type GatewayKind,
  type GatewayRow,
  type GatewayView,
  egressClassFor,
  mergeGatewayHealth,
} from '@/lib/gateways-policy';

const DEFAULT_ORG = 'default';

// ─── self-migrate safety net (memoized; mirrors ensureGuardrailRulesSchema) ───────────────────────
// The canonical schema is the drizzle `gateways` pgTable in src/db/schema.ts; this CREATE TABLE IF
// NOT EXISTS lets the store work on a DB that hasn't run the migration yet (deploy is rsync-only,
// no migration step over SSH). Column names MUST match schema.ts exactly.
let ensurePromise: Promise<void> | null = null;
export async function ensureGatewaysSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gateways (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        kind text NOT NULL,
        base_url text NOT NULL DEFAULT '',
        default_model text NOT NULL DEFAULT '',
        egress_class text NOT NULL DEFAULT 'cloud',
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS gateways_org_idx ON gateways (org_id);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// Map a DB row → the pure-layer view. egressClass is re-derived from kind so a drifted row is corrected.
function toRow(r: GatewayRowDb): GatewayRow {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    kind: r.kind,
    baseUrl: r.baseUrl,
    defaultModel: r.defaultModel,
    egressClass: egressClassFor(r.kind),
    enabled: r.enabled,
    createdAt: r.createdAt,
  };
}

export interface CreateGatewayInput {
  name: string;
  kind: GatewayKind;
  baseUrl: string;
  defaultModel: string;
  egressClass: EgressClass;
  enabled: boolean;
  /** Stable id for seeding; omitted ⇒ a random gw_… id. */
  id?: string;
}

/** List a org's gateway registry rows (raw, no health). Stable order (name asc). */
export async function listGatewayRows(orgId: string = DEFAULT_ORG): Promise<GatewayRow[]> {
  await ensureGatewaysSchema();
  const rows = await db
    .select()
    .from(gateways)
    .where(eq(gateways.orgId, orgId))
    .orderBy(asc(gateways.name), asc(gateways.id));
  return rows.map(toRow);
}

/** One gateway row by id, org-scoped. Null if absent for this org. */
export async function getGatewayRow(id: string, orgId: string = DEFAULT_ORG): Promise<GatewayRow | null> {
  await ensureGatewaysSchema();
  const rows = await db
    .select()
    .from(gateways)
    .where(and(eq(gateways.id, id), eq(gateways.orgId, orgId)))
    .limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Create a gateway. egressClass is always re-derived from kind (never trusted from input). */
export async function createGateway(
  input: CreateGatewayInput,
  orgId: string = DEFAULT_ORG,
): Promise<GatewayRow> {
  await ensureGatewaysSchema();
  const id = input.id ?? `gw_${randomUUID().slice(0, 12)}`;
  const [row] = await db
    .insert(gateways)
    .values({
      id,
      orgId,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      defaultModel: input.defaultModel,
      egressClass: egressClassFor(input.kind),
      enabled: input.enabled,
    })
    .onConflictDoNothing({ target: gateways.id })
    .returning();
  // onConflictDoNothing returns nothing when the id already existed (idempotent seed) — read it back.
  if (row) return toRow(row);
  const existing = await getGatewayRow(id, orgId);
  if (existing) return existing;
  // Different org owns this id, or a race: fall back to a fresh id insert.
  const fresh = `gw_${randomUUID().slice(0, 12)}`;
  const [row2] = await db
    .insert(gateways)
    .values({
      id: fresh,
      orgId,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      defaultModel: input.defaultModel,
      egressClass: egressClassFor(input.kind),
      enabled: input.enabled,
    })
    .returning();
  return toRow(row2);
}

/** A validated update patch (from validateGatewayUpdate). egressClass is re-derived, never trusted. */
export interface UpdateGatewayInput {
  name: string;
  kind: GatewayKind;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
}

/**
 * Update a gateway, org-scoped. egressClass is ALWAYS re-derived from the (possibly new) kind —
 * never taken from the caller — so a kind change flips egress consistently. Returns the fresh row,
 * or null when no row for this org+id exists (graceful 404 at the route). Writes name/kind/baseUrl/
 * defaultModel/enabled + the derived egressClass.
 */
export async function updateGateway(
  id: string,
  patch: UpdateGatewayInput,
  orgId: string = DEFAULT_ORG,
): Promise<GatewayRow | null> {
  await ensureGatewaysSchema();
  const [row] = await db
    .update(gateways)
    .set({
      name: patch.name,
      kind: patch.kind,
      baseUrl: patch.baseUrl,
      defaultModel: patch.defaultModel,
      egressClass: egressClassFor(patch.kind),
      enabled: patch.enabled,
    })
    .where(and(eq(gateways.id, id), eq(gateways.orgId, orgId)))
    .returning();
  return row ? toRow(row) : null;
}

/** Delete a gateway, org-scoped. True if a row was removed. */
export async function deleteGateway(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureGatewaysSchema();
  const rows = await db
    .delete(gateways)
    .where(and(eq(gateways.id, id), eq(gateways.orgId, orgId)))
    .returning({ id: gateways.id });
  return rows.length > 0;
}

// ─── live health gathering (I/O) ──────────────────────────────────────────────────────────────────

/** On-prem cluster health from the aggregator's GET /nodes: configured = any nodes listed;
 *  reachable = any node up/degraded. Never throws — an unreachable aggregator ⇒ down. */
async function onPremSignal(): Promise<GatewayHealthSignal> {
  try {
    const r = await fetch(`${GATEWAY_URL}/nodes`, {
      cache: 'no-store',
      headers: gatewayHeaders(),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return { configured: true, reachable: false, status: 'down', detail: `aggregator ${r.status}` };
    const d = (await r.json()) as { nodes?: Array<{ health?: string }> };
    const nodes = Array.isArray(d.nodes) ? d.nodes : [];
    const up = nodes.filter((n) => n.health === 'up' || n.health === 'degraded').length;
    if (nodes.length === 0) return { configured: false, reachable: false, status: 'unconfigured', detail: 'no nodes' };
    return {
      configured: true,
      reachable: up > 0,
      status: up === 0 ? 'down' : up < nodes.length ? 'degraded' : 'up',
      detail: `${up} of ${nodes.length} nodes up`,
    };
  } catch {
    return { configured: false, reachable: false, status: 'down', detail: 'aggregator unreachable' };
  }
}

/** Probe a cloud provider's /models endpoint — any answer (even 401) proves reachability. */
async function probeCloud(baseUrl: string): Promise<boolean> {
  try {
    await fetch(`${baseUrl}/models`, { method: 'GET', signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the live health signal for ONE cloud gateway from the existing cloud-providers config +
 * a probe. `configured` = the provider (matched by kind) has base URL+key in env. `reachable` is
 * only probed when configured (an unconfigured provider has no meaningful endpoint). DRY: reads
 * cloudProviderStatuses, never re-implements provider config.
 */
async function cloudSignal(kind: string): Promise<GatewayHealthSignal> {
  const statuses = cloudProviderStatuses(process.env as Record<string, string | undefined>);
  // Map a gateway kind → the cloud-provider id it corresponds to. compat ≡ the generic 'compat' provider.
  const providerId = kind === 'openai' ? 'openai' : kind === 'anthropic' ? 'anthropic' : 'compat';
  const s = statuses.find((p) => p.id === providerId);
  if (!s || !s.configured) {
    return { configured: false, reachable: false, status: 'unconfigured', detail: 'not configured' };
  }
  const reachable = await probeCloud(s.baseUrl);
  return {
    configured: true,
    reachable,
    status: reachable ? 'up' : 'down',
    detail: reachable ? 'provider reachable' : 'provider not answering',
  };
}

/** Gather the live health signal for a single gateway row by its kind. */
async function signalFor(row: GatewayRow): Promise<GatewayHealthSignal> {
  return row.kind === 'on-prem' ? onPremSignal() : cloudSignal(row.kind);
}

/**
 * List an org's gateways MERGED with live health — the UI's honest view. The on-prem probe runs at
 * most once (shared across all on-prem rows); cloud rows probe their provider. Availability comes
 * from the pure `mergeGatewayHealth` (enabled+configured+reachable), never faked.
 */
export async function listGatewaysWithHealth(orgId: string = DEFAULT_ORG): Promise<GatewayView[]> {
  const rows = await listGatewayRows(orgId);
  // Probe the on-prem aggregator at most once, even with several on-prem rows.
  const hasOnPrem = rows.some((r) => r.kind === 'on-prem');
  const onPrem = hasOnPrem ? await onPremSignal() : null;
  return Promise.all(
    rows.map(async (row) => {
      const signal = row.kind === 'on-prem' ? (onPrem as GatewayHealthSignal) : await signalFor(row);
      return mergeGatewayHealth(row, signal);
    }),
  );
}

/** One gateway merged with live health, org-scoped. Null if absent. */
export async function getGatewayWithHealth(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<GatewayView | null> {
  const row = await getGatewayRow(id, orgId);
  if (!row) return null;
  return mergeGatewayHealth(row, await signalFor(row));
}
