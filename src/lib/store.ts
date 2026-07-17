// Persistence for the node↔console state — real Postgres via Drizzle. Same exported
// signatures the routes/UI already use (now async). Schema lives in src/db/schema.ts.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  abacRules,
  apiKeys,
  auditEvents,
  commands,
  connectors,
  customAgents,
  customRoles,
  datasets,
  devices,
  enrollmentTokens,
  featureFlags,
  governanceItems,
  ingestJobs,
  maskingRules,
  orgSettings,
  promptVersions,
  prompts,
  policies,
  routingRules,
  tenants,
  tools,
  users,
} from '@/db/schema';
import {
  type AuditEvent as CanonicalAuditEvent,
  type AuditEventInput,
  buildAuditEvent,
} from '@/lib/audit-event';
import type { ChatBindingGovernance } from '@/lib/chat-pipeline-policy';
import type { CheckResult } from '@/lib/checks';
// The live connector query path lives in connector-exec.ts (Builder Epic Phase 0). `recordCount`
// backs realRecordCount below; execConnectorQuery is re-exported so callers keep one import site.
import type { ActivityQuery, ActivityRow, ProvenanceCoverage } from '@/lib/compliance-activity';
import { recordCount } from '@/lib/connector-exec';
export { execConnectorQuery, recordCount } from '@/lib/connector-exec';
export type { ConnectorTarget, ConnectorQuery, ConnectorQueryResult } from '@/lib/connector-exec';
import { type EdgeIntent, defaultIntent } from '@/lib/edge-intent';
import { emitSpan } from '@/lib/otel';
import { type RoutingDecision, decideRouting } from '@/lib/routing-policy';
import { shipAudit, shipAuditEvent } from '@/lib/siem';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { slugifyTenant } from '@/lib/tenant-domain';

// Additive columns/tables for Wave-2 org/connector parity. Created idempotently on first use so
// the deploy needs no migration step (matches the chat module's ensure* pattern). Memoized.
let orgEnsure: Promise<void> | null = null;
export async function ensureOrgSchema(): Promise<void> {
  if (orgEnsure) return orgEnsure;
  orgEnsure = (async (): Promise<void> => {
    await db.execute(
      sql`ALTER TABLE tools ADD COLUMN IF NOT EXISTS policy text NOT NULL DEFAULT 'approval';`,
    );
    await db.execute(
      sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS endpoint text NOT NULL DEFAULT '';`,
    );
    await db.execute(
      sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS auth text NOT NULL DEFAULT 'none';`,
    );
    await db.execute(
      sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';`,
    );
    await db.execute(
      sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;`,
    );
    // Agent-owned pipeline binding. Existing rows remain deliberately unbound; they must not start
    // inheriting chat governance merely because this column was introduced.
    await db.execute(sql`ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS pipeline_id text;`);
    // Wave-2 hardening: ingest jobs get a tenant scope, devices get a random data-plane secret.
    await db.execute(
      sql`ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`,
    );
    await db.execute(sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS token text;`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS org_settings (
        id text PRIMARY KEY DEFAULT 'org', system_prompt text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL DEFAULT '');
    `);
    // Governed chat binding (CONSUMERS-BIND #166): org-default chat pipeline + available-for-chat set.
    await db.execute(
      sql`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS default_chat_pipeline_id text;`,
    );
    await db.execute(
      sql`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS chat_pipeline_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb;`,
    );
    // ─── SECURITY WAVE 1 — org_settings PER-TENANT redesign (P0) ───────────────────────────────
    // org_settings was a SINGLE shared row (id='org') across ALL tenants: one system prompt + one
    // governed chat-pipeline allowlist for the whole fleet. It is now keyed by ORG — the `id` column
    // IS the org id (one row per tenant). Drop the fixed 'org' default and re-home the legacy
    // singleton onto the DEFAULT_ORG key so the single-tenant deploy keeps its existing config.
    await db.execute(sql`ALTER TABLE org_settings ALTER COLUMN id DROP DEFAULT;`);
    // Re-home the legacy singleton onto DEFAULT_ORG. If a 'default' row already exists (a partially
    // migrated DB), the bare UPDATE would collide on the PK — so drop the stale 'org' row in that
    // case and only rename it when no 'default' row is present yet. Idempotent + safe to re-run.
    await db.execute(
      sql`DELETE FROM org_settings WHERE id = 'org' AND EXISTS (SELECT 1 FROM org_settings WHERE id = 'default');`,
    );
    await db.execute(sql`UPDATE org_settings SET id = 'default' WHERE id = 'org';`);
    // ─── SECURITY WAVE 1 — tenant-scope columns on the shared tables (Job A) ────────────────────
    // Each is idempotent (ADD COLUMN IF NOT EXISTS) so it self-migrates on first use + can be applied
    // on the server via the pg client (drizzle-kit push hangs over SSH). Defaults to 'default' so
    // pre-hardening rows/backfill are safe; reads filter on it, writes stamp the caller's org.
    // Guarded ADD COLUMN: only runs when the table already exists (to_regclass IS NOT NULL). Some of
    // these tables are created lazily by OTHER modules' own ensure* functions (prompt_library,
    // prompt_partials, chat_skills, chat_memory), so ADD COLUMN must not hard-fail when a table
    // hasn't been created yet — the column is added the next time ensureOrgSchema runs after its
    // owning table exists (both are idempotent). devices/audit_events/abac_rules/routing_rules/
    // feature_flags/enrollment_tokens are schema.ts tables present after db:push.
    // `table` is always a hardcoded constant below (never user input), so sql.raw for the identifier
    // is safe. The DO/to_regclass guard makes the ADD COLUMN a no-op when the table doesn't exist yet.
    const addOrgCol = (table: string) =>
      db.execute(
        sql.raw(
          `DO $$ BEGIN IF to_regclass('"${table}"') IS NOT NULL THEN ` +
            `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default'; ` +
            `END IF; END $$;`,
        ),
      );
    for (const t of [
      'devices',
      'audit_events',
      'abac_rules',
      'routing_rules',
      'prompt_library',
      'prompt_partials',
      'chat_skills',
      'chat_memory',
      'custom_roles',
      'enrollment_tokens',
      // masking_rules + api_keys declare org_id in schema.ts and the P1 IDOR fixes scope their
      // mutations on it — re-assert it here so a DB whose tables predate the column self-heals
      // (setMaskingRuleEnabled / setApiKeyEnabled / setKeyRateLimit filter on org_id).
      'masking_rules',
      'api_keys',
      // `user` already declares org_id in schema.ts (getUserOrgByEmail relies on it); re-assert it
      // here so a not-fully-pushed DB self-heals — listUsers/createConsoleUser filter/stamp on it.
      'user',
    ]) {
      await addOrgCol(t);
    }
    // feature_flags: add org_id + rebuild the PK from (key) to the composite (org_id, key) so the
    // same key can coexist per tenant. Idempotent + safe to re-run across restarts + guarded on the
    // table's existence: rebuild the PK ONLY when the current one isn't already the composite (a DO
    // block, so re-adding an existing composite PK never errors).
    await addOrgCol('feature_flags');
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('feature_flags') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'feature_flags'::regclass AND i.indisprimary AND a.attname = 'org_id'
        ) THEN
          ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_pkey;
          ALTER TABLE feature_flags ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (org_id, key);
        END IF;
      END $$;
    `);
    // custom_roles: legacy idempotent create omitted org_id — created here (so an upgraded deploy has
    // the table), then the org_id column is added by the addOrgCol loop above.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_roles (
        id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
        based_on text NOT NULL DEFAULT 'viewer', capabilities jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    await addOrgCol('custom_roles');
  })();
  return orgEnsure;
}

export type DeviceOS = 'macOS' | 'iOS' | 'Windows';
export type DeviceStatus = 'online' | 'offline';

export interface Device {
  id: string;
  name: string;
  os: DeviceOS;
  role: string;
  status: DeviceStatus;
  lastSeen: string;
  policyVersion: number;
  enrolledAt: string;
}

export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  attribute: string;
  operator: string;
  value: string;
  action: string; // local | cloud | block
  model: string;
  fallback: string;
  enabled: boolean;
}

export interface PolicyBundle {
  version: number;
  egressAllowed: boolean;
  guardrails: string[];
  allowedModels: string[];
  routingRules: RoutingRule[];
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  deviceId: string;
  ts: string;
  model: string;
  tokens: number;
  leftDevice: boolean;
  tool: string | null;
  outcome: 'ok' | 'blocked' | 'redacted';
  latencyMs?: number;
  checks?: CheckResult[];
  keyId?: string | null;
}

export interface EnrollmentToken {
  token: string;
  role: string;
  createdAt: string;
  used: boolean;
}

export interface Command {
  id: string;
  deviceId: string;
  type: 'kill' | 'reprovision';
  createdAt: string;
  consumed: boolean;
}

type DeviceRow = typeof devices.$inferSelect;
type PolicyRow = typeof policies.$inferSelect;
type AuditRow = typeof auditEvents.$inferSelect;
type CommandRow = typeof commands.$inferSelect;

function isoOrUndef(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : undefined;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toDevice(r: DeviceRow): Device {
  return {
    id: r.id,
    name: r.name,
    os: r.os as DeviceOS,
    role: r.role,
    status: r.status as DeviceStatus,
    lastSeen: r.lastSeen,
    policyVersion: r.policyVersion,
    enrolledAt: iso(r.enrolledAt),
  };
}

function toPolicy(r: PolicyRow): PolicyBundle {
  return {
    version: r.version,
    egressAllowed: r.egressAllowed,
    guardrails: r.guardrails,
    allowedModels: r.allowedModels,
    routingRules: [],
    updatedAt: iso(r.updatedAt),
  };
}

function toAudit(r: AuditRow): AuditEvent {
  return {
    id: r.id,
    deviceId: r.deviceId,
    ts: iso(r.ts),
    model: r.model,
    tokens: r.tokens,
    leftDevice: r.leftDevice,
    tool: r.tool,
    outcome: r.outcome as AuditEvent['outcome'],
    latencyMs: r.latencyMs,
    checks: (r.checks as CheckResult[] | null) ?? undefined,
    keyId: r.keyId,
  };
}

function toCommand(r: CommandRow): Command {
  return {
    id: r.id,
    deviceId: r.deviceId,
    type: r.type as Command['type'],
    createdAt: iso(r.createdAt),
    consumed: r.consumed,
  };
}

// Tenant-scoped: only returns devices for `orgId` (defaults to DEFAULT_ORG so single-tenant callers
// are unchanged). Without the filter this listed the WHOLE fleet across tenants (P0). Console/admin
// callers pass currentOrgId().
export async function listDevices(orgId: string = DEFAULT_ORG): Promise<Device[]> {
  await ensureOrgSchema();
  const rows = await db.select().from(devices).where(eq(devices.orgId, orgId));
  return rows.map(toDevice);
}

// Org-scoped read of one device. `id`+`org` so another tenant can never read a device by guessing its
// id (defense-in-depth for the destructive kill/command/role routes). Defaults to DEFAULT_ORG.
export async function getDevice(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<Device | undefined> {
  await ensureOrgSchema();
  const [row] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.id, id), eq(devices.orgId, orgId)))
    .limit(1);
  return row ? toDevice(row) : undefined;
}

// Reassign a device's policy ROLE — the per-device dimension that selects which routing rules /
// policy bundle apply (the policy bundle itself is org-wide; role is what varies per device). This
// is the console's real "reassign policy" action. Org-scoped (id+org) so a tenant can't re-role
// another tenant's device. Returns the updated Device, or null if unknown / cross-org.
export async function updateDeviceRole(
  id: string,
  role: string,
  orgId: string = DEFAULT_ORG,
): Promise<Device | null> {
  await ensureOrgSchema();
  const [row] = await db
    .update(devices)
    .set({ role })
    .where(and(eq(devices.id, id), eq(devices.orgId, orgId)))
    .returning();
  return row ? toDevice(row) : null;
}

// Mint an enrollment token stamped with the issuing admin's org (defaults to DEFAULT_ORG) so the node
// that redeems it is enrolled into the right tenant.
export async function createEnrollmentToken(
  role: string,
  orgId: string = DEFAULT_ORG,
): Promise<EnrollmentToken> {
  await ensureOrgSchema();
  const [row] = await db
    .insert(enrollmentTokens)
    .values({ token: `enr_${randomUUID().slice(0, 12)}`, role, orgId })
    .returning();
  return { token: row.token, role: row.role, createdAt: iso(row.createdAt), used: row.used };
}

// The one-time device secret returned to a node at enrollment. Random per device, stored on the row,
// verified on every data-plane call. `dt_` prefix keeps it recognizable in logs; the entropy is the
// UUID, not the id (unlike the legacy predictable dt_<id>).
function mintDeviceToken(): string {
  return `dt_${randomUUID()}${randomUUID()}`.replaceAll('-', '');
}

// Enroll a node. Returns the Device AND its freshly-minted data-plane token (shown ONCE — the node
// stores it and presents it as a Bearer on every /devices/[id]/* call). Null on invalid/used token.
export async function enrollDevice(
  token: string,
  name: string,
  os: DeviceOS,
): Promise<{ device: Device; deviceToken: string } | null> {
  await ensureOrgSchema();
  const [rec] = await db
    .select()
    .from(enrollmentTokens)
    .where(eq(enrollmentTokens.token, token))
    .limit(1);
  if (!rec || rec.used) return null;
  await db.update(enrollmentTokens).set({ used: true }).where(eq(enrollmentTokens.token, token));
  const policy = await getOrgPolicy();
  const deviceToken = mintDeviceToken();
  const [row] = await db
    .insert(devices)
    .values({
      id: `dev_${randomUUID().slice(0, 6)}`,
      // Inherit the enrollment token's org so the device lands in the tenant that issued the token.
      orgId: rec.orgId ?? DEFAULT_ORG,
      name,
      os,
      role: rec.role,
      status: 'online',
      lastSeen: 'just now',
      policyVersion: policy.version,
      token: deviceToken,
    })
    .returning();
  return { device: toDevice(row), deviceToken };
}

// The stored per-device data-plane secret (or null when the device is unknown / pre-hardening with no
// stored token). The data-plane routes pass this to the pure verifyDeviceToken(). Never surfaced to
// the UI — devices are listed via toDevice() which omits the token.
export async function getDeviceToken(id: string): Promise<string | null> {
  await ensureOrgSchema();
  const [row] = await db
    .select({ token: devices.token })
    .from(devices)
    .where(eq(devices.id, id))
    .limit(1);
  return row ? (row.token ?? null) : null;
}

export async function getOrgPolicy(): Promise<PolicyBundle> {
  const [row] = await db.select().from(policies).orderBy(desc(policies.version)).limit(1);
  const rules = await listRoutingRules();
  if (!row) {
    return {
      version: 0,
      egressAllowed: false,
      guardrails: [],
      allowedModels: [],
      routingRules: rules,
      updatedAt: iso(new Date()),
    };
  }
  return { ...toPolicy(row), routingRules: rules };
}

export async function pushPolicy(
  patch: Partial<Omit<PolicyBundle, 'version' | 'updatedAt'>>,
): Promise<PolicyBundle> {
  const current = await getOrgPolicy();
  const [row] = await db
    .insert(policies)
    .values({
      version: current.version + 1,
      egressAllowed: patch.egressAllowed ?? current.egressAllowed,
      guardrails: patch.guardrails ?? current.guardrails,
      allowedModels: patch.allowedModels ?? current.allowedModels,
    })
    .returning();
  return toPolicy(row);
}

// A node pulling its policy: it converges to the org version and reports in.
// Data-plane pull: the node authenticates as ITSELF (device token) so this is keyed by device id.
// It reads the device row directly (not org-scoped getDevice) because the device's identity is the
// bearer secret, not a console session's org.
export async function pullPolicyForDevice(id: string): Promise<PolicyBundle | null> {
  await ensureOrgSchema();
  const [device] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  if (!device) return null;
  const policy = await getOrgPolicy();
  await db
    .update(devices)
    .set({ policyVersion: policy.version, status: 'online', lastSeen: 'just now' })
    .where(eq(devices.id, id));
  return policy;
}

// Data-plane append: device-token authed, keyed by the device's own id. Stamps each audit row with
// the DEVICE's org (looked up from the row) so listAudit can scope by tenant — a device can only
// ever write into its own org's audit trail.
export async function appendAudit(
  deviceId: string,
  events: Omit<AuditEvent, 'id' | 'deviceId'>[],
): Promise<number> {
  await ensureOrgSchema();
  const [device] = await db
    .select({ orgId: devices.orgId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  const orgId = device?.orgId ?? DEFAULT_ORG;
  await db
    .update(devices)
    .set({ status: 'online', lastSeen: 'just now' })
    .where(eq(devices.id, deviceId));
  if (events.length === 0) return 0;
  const rows = events.map((e) => ({
    id: randomUUID(),
    deviceId,
    orgId,
    ts: new Date(e.ts),
    model: e.model,
    tokens: e.tokens,
    leftDevice: e.leftDevice,
    tool: e.tool,
    outcome: e.outcome,
    latencyMs: e.latencyMs ?? 0, // never fabricate latency — 0 = unknown (Phase 4.7)
    checks: e.checks ?? null,
    keyId: e.keyId ?? null,
  }));
  await db.insert(auditEvents).values(rows);
  for (const e of events) {
    emitSpan('audit.event', { deviceId, model: e.model, outcome: e.outcome, tokens: e.tokens });
  }
  // Mirror to the SIEM (OpenSearch) if configured — best-effort, off the request path.
  shipAudit(rows.map((r) => ({ ...r, ts: r.ts.toISOString() })));
  return events.length;
}

// Tenant-scoped: only returns audit events for `orgId` (defaults to DEFAULT_ORG so single-tenant
// callers are unchanged). Without the filter this returned EVERY tenant's device/gateway audit
// trail — a compliance-fatal cross-tenant leak (P0). Console/admin callers pass currentOrgId().
export async function listAudit(opts?: {
  deviceId?: string;
  limit?: number;
  orgId?: string;
}): Promise<AuditEvent[]> {
  await ensureOrgSchema();
  const limit = opts?.limit ?? 100;
  const orgId = opts?.orgId ?? DEFAULT_ORG;
  const where = opts?.deviceId
    ? and(eq(auditEvents.orgId, orgId), eq(auditEvents.deviceId, opts.deviceId))
    : eq(auditEvents.orgId, orgId);
  const rows = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.ts))
    .limit(limit);
  return rows.map(toAudit);
}

// ─── Canonical attributed audit events (Phase 4.11) ───────────────────────────
// The device-keyed `audit_events` table above is the pre-4.11 gateway/device stream. The canonical
// attributed events (who did what, per the roadmap contract) land in `audit_events_v2` — created
// idempotently so the deploy needs no migration (matches the ensure* pattern). Postgres is the
// source of truth; every write ALSO ships to OpenSearch. Both are best-effort — a failed audit
// NEVER fails the action it records.
let auditV2Ensure: Promise<void> | null = null;
async function ensureAuditV2(): Promise<void> {
  if (auditV2Ensure) return auditV2Ensure;
  auditV2Ensure = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS audit_events_v2 (
        id text PRIMARY KEY,
        ts timestamptz NOT NULL DEFAULT now(),
        actor_type text NOT NULL,
        actor_id text NOT NULL,
        actor_label text NOT NULL DEFAULT '',
        org text NOT NULL DEFAULT 'default',
        project text,
        action text NOT NULL,
        resource text,
        model text,
        prompt_tokens integer,
        completion_tokens integer,
        total_tokens integer,
        cost_usd double precision,
        outcome text NOT NULL,
        run_id text,
        ip text
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_v2_ts_idx ON audit_events_v2 (ts DESC);`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS audit_v2_actor_idx ON audit_events_v2 (actor_id);`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS audit_v2_action_idx ON audit_events_v2 (action);`,
    );
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_v2_org_idx ON audit_events_v2 (org);`);
  })();
  return auditV2Ensure;
}

// Persist a canonical audit event to Postgres (source of truth) AND ship it to OpenSearch.
// Best-effort / non-blocking: both sinks are wrapped so a failure never propagates to the caller —
// an audited action must never fail because auditing failed. Returns the normalized event so a
// caller can log/inspect it. Producers use `recordAudit` (the fire-and-forget wrapper) instead.
export async function persistAuditEvent(input: AuditEventInput): Promise<CanonicalAuditEvent> {
  const ev = buildAuditEvent(input);
  // Ship first (independent, cheap, already best-effort inside shipAuditEvent).
  shipAuditEvent(input);
  try {
    await ensureAuditV2();
    await db.execute(sql`
      INSERT INTO audit_events_v2
        (id, ts, actor_type, actor_id, actor_label, org, project, action, resource, model,
         prompt_tokens, completion_tokens, total_tokens, cost_usd, outcome, run_id, ip)
      VALUES (
        ${randomUUID()}, ${ev.ts}, ${ev.actor.type}, ${ev.actor.id}, ${ev.actor.label}, ${ev.org},
        ${ev.project ?? null}, ${ev.action}, ${ev.resource ?? null}, ${ev.model ?? null},
        ${ev.tokens?.prompt ?? null}, ${ev.tokens?.completion ?? null}, ${ev.tokens?.total ?? null},
        ${ev.costUsd ?? null}, ${ev.outcome}, ${ev.runId ?? null}, ${ev.ip ?? null}
      );
    `);
    emitSpan('audit.event.v2', { action: ev.action, actor: ev.actor.id, outcome: ev.outcome });
  } catch {
    /* best-effort — Postgres audit insert must never fail the action */
  }
  return ev;
}

// Fire-and-forget producer entry point: record a canonical audit event without awaiting or throwing.
// This is what governance / data / access producers call inline right after their write completes.
export function recordAudit(input: AuditEventInput): void {
  void persistAuditEvent(input).catch(() => {});
}

// ─── Compliance-activity read (Regulatory / DPO evidence over a time range) ───────────────────
// Read the REAL canonical audit ledger (`audit_events_v2`) for a window + org, plus provenance
// coverage from `agent_runs`, so the Regulatory export/DPO view aggregates who-did-what /
// what-was-blocked / cost from actual data (no mocks). The pure aggregation + serialization live in
// `compliance-activity.ts`; this is the thin I/O seam. Best-effort: an empty/absent table yields an
// empty window rather than throwing.
export async function readComplianceActivity(
  q: ActivityQuery,
): Promise<{ rows: ActivityRow[]; coverage: ProvenanceCoverage }> {
  const org = (q.org ?? DEFAULT_ORG).trim() || DEFAULT_ORG;
  const from = q.from && !Number.isNaN(Date.parse(q.from)) ? new Date(q.from).toISOString() : null;
  const to = q.to && !Number.isNaN(Date.parse(q.to)) ? new Date(q.to).toISOString() : null;

  let rows: ActivityRow[] = [];
  try {
    await ensureAuditV2();
    const res = await db.execute(sql`
      SELECT ts, actor_type, actor_id, actor_label, org, project, action, resource, model,
             total_tokens, cost_usd, outcome, run_id
      FROM audit_events_v2
      WHERE org = ${org}
        AND (${from}::timestamptz IS NULL OR ts >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR ts <= ${to}::timestamptz)
      ORDER BY ts DESC
      LIMIT 20000`);
    const list =
      (res as unknown as { rows?: Record<string, unknown>[] }).rows ??
      (res as unknown as Record<string, unknown>[]);
    rows = (list as Record<string, unknown>[]).map((r) => ({
      ts: isoOrUndef(r.ts),
      actorType: r.actor_type == null ? undefined : String(r.actor_type),
      actorId: r.actor_id == null ? undefined : String(r.actor_id),
      actorLabel: r.actor_label == null ? undefined : String(r.actor_label),
      org: r.org == null ? undefined : String(r.org),
      project: r.project == null ? null : String(r.project),
      action: r.action == null ? undefined : String(r.action),
      resource: r.resource == null ? null : String(r.resource),
      model: r.model == null ? null : String(r.model),
      totalTokens: r.total_tokens == null ? null : Number(r.total_tokens),
      costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
      outcome: r.outcome == null ? undefined : String(r.outcome),
      runId: r.run_id == null ? null : String(r.run_id),
    }));
  } catch {
    /* best-effort — a missing table / read error yields an empty window, never a 500 */
  }

  // Provenance coverage over the same window: how many agent runs, how many carry a signed record.
  let coverage: ProvenanceCoverage = { runs: 0, signed: 0 };
  try {
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS runs,
             COUNT(*) FILTER (WHERE provenance IS NOT NULL)::int AS signed
      FROM agent_runs
      WHERE org_id = ${org}
        AND (${from}::timestamptz IS NULL OR started_at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR started_at <= ${to}::timestamptz)`);
    const row =
      ((res as unknown as { rows?: { runs?: unknown; signed?: unknown }[] }).rows ??
        (res as unknown as { runs?: unknown; signed?: unknown }[]))[0] ?? {};
    coverage = { runs: Number(row.runs ?? 0), signed: Number(row.signed ?? 0) };
  } catch {
    /* best-effort */
  }

  return { rows, coverage };
}

// Queue a kill-switch command for a device. Org-scoped: the device must belong to `orgId` (defaults
// to DEFAULT_ORG), so an admin on tenant A can never kill/wipe tenant B's device by guessing its id
// (destructive cross-tenant IDOR — P0). Returns null when the device is unknown OR in another org.
export async function queueKill(
  deviceId: string,
  orgId: string = DEFAULT_ORG,
): Promise<Command | null> {
  const device = await getDevice(deviceId, orgId);
  if (!device) return null;
  const [row] = await db
    .insert(commands)
    .values({ id: randomUUID(), deviceId, type: 'kill' })
    .returning();
  return toCommand(row);
}

export async function takeCommands(deviceId: string): Promise<Command[]> {
  const rows = await db
    .update(commands)
    .set({ consumed: true })
    .where(and(eq(commands.deviceId, deviceId), eq(commands.consumed, false)))
    .returning();
  return rows.map(toCommand);
}

export async function listPolicyHistory(): Promise<PolicyBundle[]> {
  const rows = await db.select().from(policies).orderBy(desc(policies.version));
  return rows.map(toPolicy);
}

export interface ConsoleUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}

// Tenant-scoped: only returns users in `orgId` (defaults to DEFAULT_ORG so single-tenant callers are
// unchanged). Without the filter this returned the WHOLE cross-tenant user directory (P0) — it also
// feeds IdP/SCIM provisioning. Admin/SCIM callers pass currentOrgId().
export async function listUsers(orgId: string = DEFAULT_ORG): Promise<ConsoleUser[]> {
  await ensureOrgSchema();
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.orgId, orgId));
}

// The org a user belongs to (tenant membership), looked up by email at sign-in so the JWT can carry
// it. Null when the user has no row yet (first federated login) — callers fall back to the default
// org. This is the source of truth for currentOrgId's membership check.
export async function getUserOrgByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const [row] = await db
    .select({ orgId: users.orgId })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return row?.orgId ?? null;
}

// SCIM provisioning: create (or upsert by email) a console user. Idempotent on email so a repeated
// SCIM POST is safe. Returns the row in ConsoleUser shape.
export async function createConsoleUser(input: {
  email: string;
  name?: string | null;
  role?: string;
  orgId?: string;
}): Promise<ConsoleUser> {
  await ensureOrgSchema();
  const [existing] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing) return existing;
  // Stamp the provisioning caller's org so a SCIM/admin-created user lands in that tenant (not the
  // shared 'default'). Defaults to DEFAULT_ORG. Email is globally unique — a user has one org.
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      name: input.name ?? null,
      role: input.role ?? 'viewer',
      orgId: input.orgId ?? DEFAULT_ORG,
    })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
  return row;
}

// Org-scoped role change (id+org) so an admin can't re-role a user outside their tenant. Defaults to
// DEFAULT_ORG. Returns null when the user is unknown OR in another org.
export async function setUserRole(
  id: string,
  role: string,
  orgId: string = DEFAULT_ORG,
): Promise<ConsoleUser | null> {
  await ensureOrgSchema();
  const [row] = await db
    .update(users)
    .set({ role })
    .where(and(eq(users.id, id), eq(users.orgId, orgId)))
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
  return row ?? null;
}

// ─── Data plane (M3) ──────────────────────────────────────────────────────────
export interface Connector {
  id: string;
  name: string;
  type: string;
  status: string;
  lastSync: string | null;
  endpoint: string;
  auth: string;
  description: string;
  custom: boolean;
}

export interface IngestJob {
  id: string;
  connectorId: string;
  connectorName: string;
  status: string;
  records: number;
  startedAt: string;
}

export interface MaskingRule {
  id: string;
  kind: string;
  action: string;
  enabled: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  source: string;
  rows: number;
  classification: string;
  updatedAt: string;
}

// Real record count for a database connector — connects to its endpoint and sums live rows.
// Returns null for non-DB connectors or unreachable endpoints (caller records 0, never fakes).
//
// The live-query implementation moved to lib/connector-exec.ts (Builder Epic Phase 0) so the
// sync path here AND the connector rule engine share ONE query path. This thin wrapper preserves
// the original signature so `syncConnector` and any other caller behave identically.
async function realRecordCount(type: string, endpoint: string): Promise<number | null> {
  return recordCount(type, endpoint);
}

function toConnector(r: typeof connectors.$inferSelect): Connector {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    lastSync: r.lastSync ? iso(r.lastSync) : null,
    endpoint: r.endpoint ?? '',
    auth: r.auth ?? 'none',
    description: r.description ?? '',
    custom: r.custom ?? false,
  };
}

// Tenant-scoped: only returns connectors for `orgId` (defaults to DEFAULT_ORG so existing
// single-tenant callers are unchanged). Callers with a session pass currentOrgId().
export async function listConnectors(orgId: string = DEFAULT_ORG): Promise<Connector[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(connectors)
    .where(eq(connectors.orgId, orgId))
    .orderBy(desc(connectors.createdAt));
  return rows.map(toConnector);
}

export async function createConnector(input: {
  name: string;
  type: string;
  endpoint?: string;
  auth?: string;
  description?: string;
  custom?: boolean;
  orgId?: string;
}): Promise<Connector> {
  await ensureOrgSchema();
  const [row] = await db
    .insert(connectors)
    .values({
      id: `con_${randomUUID().slice(0, 6)}`,
      orgId: input.orgId ?? DEFAULT_ORG,
      name: input.name,
      type: input.type,
      endpoint: input.endpoint ?? '',
      auth: input.auth ?? 'none',
      description: input.description ?? '',
      custom: input.custom ?? false,
    })
    .returning();
  return toConnector(row);
}

// Tenant-scoped: the WHERE pins BOTH id AND orgId, so a guessed/enumerated id from another tenant
// resolves to no row (returns null) — an admin can only edit connectors in their own org (P1 IDOR
// fix, mirrors listConnectors(orgId)).
export async function updateConnector(
  id: string,
  patch: { name?: string; type?: string; endpoint?: string; auth?: string; description?: string },
  orgId: string = DEFAULT_ORG,
): Promise<Connector | null> {
  const scope = and(eq(connectors.id, id), eq(connectors.orgId, orgId));
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.endpoint !== undefined) set.endpoint = patch.endpoint;
  if (patch.auth !== undefined) set.auth = patch.auth;
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) {
    const [cur] = await db.select().from(connectors).where(scope).limit(1);
    return cur ? toConnector(cur) : null;
  }
  const [row] = await db.update(connectors).set(set).where(scope).returning();
  return row ? toConnector(row) : null;
}

// Tenant-scoped delete: BOTH the ingest_jobs cascade AND the connector row are pinned to orgId, so
// org A can never delete org B's connector or purge its ingest history via a guessed id (P1 IDOR).
export async function deleteConnector(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  // Guard first: if the connector isn't in this org, do nothing — no cross-tenant vault purge or
  // cascade. The scoped deletes below would already no-op, but this also stops removeConnectorSecret
  // from resolving another org's secretRef.
  const [own] = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.orgId, orgId)))
    .limit(1);
  if (!own) return;
  // Purge the connector's vaulted credential BEFORE deleting the row — removeConnectorSecret resolves
  // the secretRef FROM the row, so the row must still exist. Best-effort (the row delete is what
  // matters); dynamic import avoids pulling the secrets/vault graph into every store consumer.
  const { removeConnectorSecret } = await import('@/lib/connector-secrets');
  await removeConnectorSecret(id).catch(() => undefined);
  await db
    .delete(ingestJobs)
    .where(and(eq(ingestJobs.connectorId, id), eq(ingestJobs.orgId, orgId)));
  await db.delete(connectors).where(and(eq(connectors.id, id), eq(connectors.orgId, orgId)));
}

export async function syncConnector(id: string): Promise<IngestJob | null> {
  await ensureOrgSchema();
  const [con] = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
  if (!con) return null;
  // Real count from the source; null (unreachable/non-DB) records 0 and marks the connector
  // in error rather than fabricating a number.
  const real = await realRecordCount(con.type, con.endpoint ?? '');
  const records = real ?? 0;
  await db
    .update(connectors)
    .set({ lastSync: new Date(), status: real === null ? 'error' : 'connected' })
    .where(eq(connectors.id, id));
  const [job] = await db
    .insert(ingestJobs)
    .values({
      id: `job_${randomUUID().slice(0, 6)}`,
      // Inherit the connector's org so listIngestJobs(orgId) can scope by tenant (P1 fix).
      orgId: con.orgId ?? DEFAULT_ORG,
      connectorId: id,
      connectorName: con.name,
      status: 'completed',
      records,
    })
    .returning();
  return {
    id: job.id,
    connectorId: job.connectorId,
    connectorName: job.connectorName,
    status: job.status,
    records: job.records,
    startedAt: iso(job.startedAt),
  };
}

// Tenant-scoped: only returns ingest jobs for `orgId` (defaults to DEFAULT_ORG). Without the filter
// this listed ALL orgs' jobs — a cross-tenant leak of ingest metadata (P1 — HARDENING_AUDIT.md).
export async function listIngestJobs(
  orgId: string = DEFAULT_ORG,
  limit = 20,
): Promise<IngestJob[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(ingestJobs)
    .where(eq(ingestJobs.orgId, orgId))
    .orderBy(desc(ingestJobs.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    connectorId: r.connectorId,
    connectorName: r.connectorName,
    status: r.status,
    records: r.records,
    startedAt: iso(r.startedAt),
  }));
}

export async function listMaskingRules(orgId: string = DEFAULT_ORG): Promise<MaskingRule[]> {
  const rows = await db
    .select()
    .from(maskingRules)
    .where(eq(maskingRules.orgId, orgId))
    .orderBy(desc(maskingRules.createdAt));
  return rows.map((r) => ({ id: r.id, kind: r.kind, action: r.action, enabled: r.enabled }));
}

export async function createMaskingRule(
  kind: string,
  action: string,
  orgId: string = DEFAULT_ORG,
): Promise<MaskingRule> {
  // orgId MUST be set on insert — else a non-default org's rule silently lands in 'default' and is
  // invisible to its creator (listMaskingRules filters by orgId). Cross-tenant scoping bug — P1.
  const [row] = await db
    .insert(maskingRules)
    .values({ id: `msk_${randomUUID().slice(0, 6)}`, kind, action, orgId })
    .returning();
  return { id: row.id, kind: row.kind, action: row.action, enabled: row.enabled };
}

// Tenant-scoped: the enable/disable toggle only lands when the rule belongs to orgId, so org A cannot
// flip org B's masking rule (which would silently unmask B's PII) via a guessed id (P1 IDOR).
export async function setMaskingRuleEnabled(
  id: string,
  enabled: boolean,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await db
    .update(maskingRules)
    .set({ enabled })
    .where(and(eq(maskingRules.id, id), eq(maskingRules.orgId, orgId)));
}

export async function listDatasets(orgId: string = DEFAULT_ORG): Promise<Dataset[]> {
  const rows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.orgId, orgId))
    .orderBy(desc(datasets.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source,
    rows: r.rows,
    classification: r.classification,
    updatedAt: iso(r.updatedAt),
  }));
}

// DSAR / right-to-erasure (stub): reports how many sensitive datasets the subject spans.
// Real propagation crosses lake + KB + vector index + memory; here we report scope.
export async function eraseSubjectScope(): Promise<number> {
  const rows = await db.select().from(datasets);
  return rows.filter((r) => r.classification === 'pii' || r.classification === 'phi').length;
}

// ─── Multi-tenant + ABAC (#10) ────────────────────────────────────────────────
export interface Tenant {
  id: string;
  name: string;
  slug: string | null;
  plan: string;
  enabledModules: string[];
  createdAt: string;
}

export interface AbacRule {
  id: string;
  role: string;
  attribute: string;
  operator: string;
  value: string;
  resource: string;
  effect: string;
}

export interface AbacContext {
  role: string;
  attributes: Record<string, string>;
  resource: string;
}

function toTenant(r: typeof tenants.$inferSelect): Tenant {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug ?? null,
    plan: r.plan,
    enabledModules: r.enabledModules,
    createdAt: iso(r.createdAt),
  };
}

export async function listTenants(): Promise<Tenant[]> {
  const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  return rows.map(toTenant);
}

// Resolve a tenant by its subdomain slug — the seam the middleware/tenancy layer uses to scope a
// request coming in on <slug>.onprem-console.getoffgridai.co to that tenant's org.
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const s = slug.trim().toLowerCase();
  if (!s) return null;
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, s)).limit(1);
  return row ? toTenant(row) : null;
}

export async function createTenant(
  name: string,
  plan: string,
  enabledModules: string[],
  slug?: string | null,
): Promise<Tenant> {
  const cleaned = slug ? slugifyTenant(slug) : slugifyTenant(name);
  const [row] = await db
    .insert(tenants)
    .values({
      id: `org_${randomUUID().slice(0, 6)}`,
      name,
      slug: cleaned || null,
      plan,
      enabledModules,
    })
    .returning();
  return toTenant(row);
}

export async function deleteTenant(id: string): Promise<void> {
  await db.delete(tenants).where(eq(tenants.id, id));
}

export async function setTenantModules(id: string, modules: string[]): Promise<Tenant | null> {
  const [row] = await db
    .update(tenants)
    .set({ enabledModules: modules })
    .where(eq(tenants.id, id))
    .returning();
  return row ? toTenant(row) : null;
}

// Tenant-scoped: ABAC rules are per-org policy (defaults to DEFAULT_ORG). Without the filter every
// tenant's rules were evaluated together in evaluateAbac — a cross-tenant policy leak.
export async function listAbacRules(orgId: string = DEFAULT_ORG): Promise<AbacRule[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(abacRules)
    .where(eq(abacRules.orgId, orgId))
    .orderBy(desc(abacRules.createdAt));
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    attribute: r.attribute,
    operator: r.operator,
    value: r.value,
    resource: r.resource,
    effect: r.effect,
  }));
}

export async function createAbacRule(
  rule: Omit<AbacRule, 'id'>,
  orgId: string = DEFAULT_ORG,
): Promise<AbacRule> {
  await ensureOrgSchema();
  const [row] = await db
    .insert(abacRules)
    .values({ id: `abac_${randomUUID().slice(0, 6)}`, orgId, ...rule })
    .returning();
  return {
    id: row.id,
    role: row.role,
    attribute: row.attribute,
    operator: row.operator,
    value: row.value,
    resource: row.resource,
    effect: row.effect,
  };
}

// Org-scoped delete (id+org) so a tenant can't delete another org's rule by id. Defaults to DEFAULT_ORG.
export async function deleteAbacRule(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensureOrgSchema();
  await db.delete(abacRules).where(and(eq(abacRules.id, id), eq(abacRules.orgId, orgId)));
}

function ruleMatches(rule: AbacRule, ctx: AbacContext): boolean {
  if (rule.role !== '*' && rule.role !== ctx.role) return false;
  if (rule.resource !== '*' && rule.resource !== ctx.resource) return false;
  const attr = ctx.attributes[rule.attribute];
  if (rule.operator === 'in') return rule.value.split(',').includes(attr);
  if (rule.operator === 'neq') return attr !== rule.value;
  return attr === rule.value;
}

// ABAC decision: deny-overrides. A matching deny wins; else a matching allow grants; else deny.
// Org-scoped: only the caller's org rules are evaluated (defaults to DEFAULT_ORG) — a tenant's ABAC
// decision must never be swayed by another tenant's rules.
export async function evaluateAbac(
  ctx: AbacContext,
  orgId: string = DEFAULT_ORG,
): Promise<{ allow: boolean; matched: AbacRule[] }> {
  const rules = await listAbacRules(orgId);
  const matched = rules.filter((r) => ruleMatches(r, ctx));
  if (matched.some((r) => r.effect === 'deny')) return { allow: false, matched };
  return { allow: matched.some((r) => r.effect === 'allow'), matched };
}

// ─── Model routing rules (smart + conditional routing / cloud leash) ───────────
function toRoutingRule(r: typeof routingRules.$inferSelect): RoutingRule {
  return {
    id: r.id,
    name: r.name,
    priority: r.priority,
    attribute: r.attribute,
    operator: r.operator,
    value: r.value,
    action: r.action,
    model: r.model,
    fallback: r.fallback,
    enabled: r.enabled,
  };
}

export async function listRoutingRules(orgId: string = DEFAULT_ORG): Promise<RoutingRule[]> {
  const rows = await db
    .select()
    .from(routingRules)
    .where(eq(routingRules.orgId, orgId))
    .orderBy(routingRules.priority);
  return rows.map(toRoutingRule);
}

export async function createRoutingRule(
  input: Omit<RoutingRule, 'id' | 'enabled'>,
  orgId: string = DEFAULT_ORG,
): Promise<RoutingRule> {
  const [row] = await db
    .insert(routingRules)
    .values({ id: `route_${randomUUID().slice(0, 8)}`, orgId, ...input })
    .returning();
  return toRoutingRule(row);
}

// Org-scoped enable/disable (id+org) so a tenant can't toggle another org's rule by id.
export async function setRoutingRuleEnabled(
  id: string,
  enabled: boolean,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await db
    .update(routingRules)
    .set({ enabled })
    .where(and(eq(routingRules.id, id), eq(routingRules.orgId, orgId)));
}

// Org-scoped delete (id+org).
export async function deleteRoutingRule(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await db.delete(routingRules).where(and(eq(routingRules.id, id), eq(routingRules.orgId, orgId)));
}

// Re-export the routing-decision type from the pure module so existing importers are unaffected.
export type { RoutingDecision } from '@/lib/routing-policy';

// Evaluate where a request runs. Thin I/O adapter: fetch the routing rules + org egress switch, then
// delegate to the PURE decideRouting() (routing-policy.ts) which owns the leash logic — first
// matching rule by priority wins, and a `cloud` action with egress OFF is downgraded to `block`.
// Org-scoped: ONLY the caller's org rules are evaluated (defaults to DEFAULT_ORG) — before this fix
// every tenant's rules were evaluated together, so one tenant's rule could route another's traffic.
export async function evaluateRouting(ctx: {
  attributes: Record<string, string>;
  orgId?: string;
}): Promise<RoutingDecision> {
  const orgId = ctx.orgId ?? DEFAULT_ORG;
  const [rules, policy] = await Promise.all([listRoutingRules(orgId), getOrgPolicy()]);
  return decideRouting(rules, ctx.attributes, policy.egressAllowed);
}

// ─── Feature flags (runtime toggles) ───────────────────────────────────────────
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
}

// Tenant-scoped: flags are per-org (defaults to DEFAULT_ORG). One tenant toggling a capability never
// flips it for another. The identity is (org_id, key).
export async function listFlags(orgId: string = DEFAULT_ORG): Promise<FeatureFlag[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.orgId, orgId))
    .orderBy(featureFlags.key);
  return rows.map((r) => ({ key: r.key, enabled: r.enabled, description: r.description }));
}

export async function setFlag(
  key: string,
  enabled: boolean,
  description = '',
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureOrgSchema();
  await db
    .insert(featureFlags)
    .values({ orgId, key, enabled, description })
    // Upsert on the COMPOSITE (org_id, key): on an existing per-org key, update enabled + description
    // (only overwrite description when a non-empty one is supplied, so a bare toggle doesn't wipe it).
    .onConflictDoUpdate({
      target: [featureFlags.orgId, featureFlags.key],
      set: description
        ? { enabled, description, updatedAt: new Date() }
        : { enabled, updatedAt: new Date() },
    });
}

export async function deleteFlag(key: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureOrgSchema();
  const res = await db
    .delete(featureFlags)
    .where(and(eq(featureFlags.orgId, orgId), eq(featureFlags.key, key)));
  return (res.rowCount ?? 0) > 0;
}

// A "gate-open" instance: OFFGRID_FLAGS_OPEN=true forces every capability ON, so nothing is gated
// regardless of which flags exist in the DB. Set per-deployment for demo/eval instances.
export function flagsForcedOpen(): boolean {
  return process.env.OFFGRID_FLAGS_OPEN === 'true';
}

// Runtime check with a default. Falls back to the default when the flag is unset. Org-scoped
// (defaults to DEFAULT_ORG) so a tenant's gate reads only its own flags.
export async function isEnabled(
  key: string,
  fallback = false,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  if (flagsForcedOpen()) return true;
  await ensureOrgSchema();
  const [row] = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.orgId, orgId), eq(featureFlags.key, key)))
    .limit(1);
  return row ? row.enabled : fallback;
}

// ─── Edge-WAF intent (Task C3) ────────────────────────────────────────────────────────────────
// The console reads the LIVE Caddy edge (edge-log.ts) but cannot safely reload Caddy from inside
// the app, so operator WAF changes are persisted as *intent* — the desired state that applies on
// the next edge reload. A single-row key/value table (`edge_intent`), created idempotently so the
// deploy needs no migration (matches the audit_events_v2 ensure* pattern; `drizzle-kit push` hangs
// over SSH). Pure validation/diff logic lives in edge-intent.ts — this is only the I/O seam.
let edgeIntentEnsure: Promise<void> | null = null;
async function ensureEdgeIntent(): Promise<void> {
  if (edgeIntentEnsure) return edgeIntentEnsure;
  edgeIntentEnsure = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS edge_intent (
        id text PRIMARY KEY DEFAULT 'default',
        intent jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  })();
  return edgeIntentEnsure;
}

// Read the persisted edge-WAF intent. Returns the default (WAF on, no custom rules) when nothing
// has been configured. Best-effort — a missing table / read error yields the default, never a 500.
export async function getEdgeIntent(): Promise<EdgeIntent> {
  try {
    await ensureEdgeIntent();
    const res = await db.execute(sql`SELECT intent FROM edge_intent WHERE id = 'default' LIMIT 1`);
    const rows =
      (res as unknown as { rows?: { intent?: unknown }[] }).rows ??
      (res as unknown as { intent?: unknown }[]);
    const raw = rows[0]?.intent;
    if (!raw) return defaultIntent();
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<EdgeIntent>;
    return {
      wafEnabled: parsed.wafEnabled !== false,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return defaultIntent();
  }
}

// Persist the edge-WAF intent (single row upsert). Throws on failure so the route can surface a 5xx
// — unlike audit, a dropped WAF change must NOT be silently swallowed.
export async function saveEdgeIntent(intent: EdgeIntent): Promise<EdgeIntent> {
  await ensureEdgeIntent();
  await db.execute(sql`
    INSERT INTO edge_intent (id, intent, updated_at)
    VALUES ('default', ${JSON.stringify(intent)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET intent = ${JSON.stringify(intent)}::jsonb, updated_at = now()
  `);
  return intent;
}

// ─── Prompt registry (templates + versioning) ──────────────────────────────────
export interface Prompt {
  id: string;
  name: string;
  description: string;
  latestVersion: number;
}
export interface PromptVersion {
  id: string;
  version: number;
  body: string;
  label: string;
  createdAt: string;
}

// Org-scoped registry. prompt_versions has no org column of its own — it inherits scope through
// its parent prompt: every version read/write first verifies the parent belongs to the caller's
// org, so a tenant can never reach another org's prompt or its version history.
export async function listPrompts(orgId: string = DEFAULT_ORG): Promise<Prompt[]> {
  const rows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.orgId, orgId))
    .orderBy(desc(prompts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    latestVersion: r.latestVersion,
  }));
}

export async function listPromptVersions(
  promptId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PromptVersion[]> {
  // Parent-scope guard: only return versions when the prompt itself belongs to the caller's org.
  const [p] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.orgId, orgId)))
    .limit(1);
  if (!p) return [];
  const rows = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.promptId, promptId))
    .orderBy(desc(promptVersions.version));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    body: r.body,
    label: r.label,
    createdAt: iso(r.createdAt),
  }));
}

export async function createPrompt(
  name: string,
  description: string,
  orgId: string = DEFAULT_ORG,
): Promise<Prompt> {
  const [row] = await db
    .insert(prompts)
    .values({ id: `pr_${randomUUID().slice(0, 8)}`, orgId, name, description })
    .returning();
  return { id: row.id, name: row.name, description: row.description, latestVersion: 0 };
}

// Publish a new version of a prompt (immutable history; bumps the prompt's latestVersion).
// Returns null when the prompt doesn't exist for the caller's org (can't version another org's).
export async function addPromptVersion(
  promptId: string,
  body: string,
  label: string,
  orgId: string = DEFAULT_ORG,
): Promise<PromptVersion | null> {
  const [p] = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.orgId, orgId)))
    .limit(1);
  if (!p) return null;
  const version = p.latestVersion + 1;
  const [row] = await db
    .insert(promptVersions)
    .values({ id: `pv_${randomUUID().slice(0, 8)}`, promptId, version, body, label })
    .returning();
  await db
    .update(prompts)
    .set({ latestVersion: version })
    .where(and(eq(prompts.id, promptId), eq(prompts.orgId, orgId)));
  return { id: row.id, version, body, label, createdAt: iso(row.createdAt) };
}

export async function deletePrompt(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  // Only cascade-delete the versions when the parent is the caller's — no cross-org reach.
  const [p] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.id, id), eq(prompts.orgId, orgId)))
    .limit(1);
  if (!p) return;
  await db.delete(promptVersions).where(eq(promptVersions.promptId, id));
  await db.delete(prompts).where(and(eq(prompts.id, id), eq(prompts.orgId, orgId)));
}

// ─── Governance registry (Phase E org wrapper) ─────────────────────────────────
export interface GovernanceItem {
  id: string;
  kind: string;
  title: string;
  owner: string;
  status: string;
  detail: string;
  reviewedAt: string;
}

function toGovernance(r: typeof governanceItems.$inferSelect): GovernanceItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    owner: r.owner,
    status: r.status,
    detail: r.detail,
    reviewedAt: r.reviewedAt,
  };
}

export async function listGovernance(orgId: string = DEFAULT_ORG): Promise<GovernanceItem[]> {
  const rows = await db
    .select()
    .from(governanceItems)
    .where(eq(governanceItems.orgId, orgId))
    .orderBy(governanceItems.kind);
  return rows.map(toGovernance);
}

export async function createGovernance(input: Omit<GovernanceItem, 'id'>): Promise<GovernanceItem> {
  const [row] = await db
    .insert(governanceItems)
    .values({ id: `gov_${randomUUID().slice(0, 8)}`, ...input })
    .returning();
  return toGovernance(row);
}

// Update the mutable fields of a governance record (title / owner / status / detail / reviewedAt).
// Only supplied fields change. Returns the updated item, or null if the id doesn't exist.
export async function updateGovernance(
  id: string,
  patch: Partial<Omit<GovernanceItem, 'id'>>,
): Promise<GovernanceItem | null> {
  const set: Partial<typeof governanceItems.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.owner !== undefined) set.owner = patch.owner;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.detail !== undefined) set.detail = patch.detail;
  if (patch.reviewedAt !== undefined) set.reviewedAt = patch.reviewedAt;
  if (Object.keys(set).length === 0) {
    const [cur] = await db.select().from(governanceItems).where(eq(governanceItems.id, id));
    return cur ? toGovernance(cur) : null;
  }
  const [row] = await db
    .update(governanceItems)
    .set(set)
    .where(eq(governanceItems.id, id))
    .returning();
  return row ? toGovernance(row) : null;
}

export async function deleteGovernance(id: string): Promise<void> {
  await db.delete(governanceItems).where(eq(governanceItems.id, id));
}

// ─── FinOps: virtual keys (token issuance) ─────────────────────────────────────
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  subjectType: string;
  subject: string;
  budgetUsd: number | null;
  enabled: boolean;
}

function toApiKey(r: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    subjectType: r.subjectType,
    subject: r.subject,
    budgetUsd: r.budgetUsd,
    enabled: r.enabled,
  };
}

export async function listApiKeys(orgId: string = DEFAULT_ORG): Promise<ApiKey[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(toApiKey);
}

// Issue a key: returns the one-time secret token (shown once) + the stored record.
export async function createApiKey(input: {
  name: string;
  subjectType: string;
  subject: string;
  budgetUsd: number | null;
  orgId?: string;
}): Promise<{ key: ApiKey; token: string }> {
  const id = `key_${randomUUID().slice(0, 8)}`;
  const secret = randomUUID().replaceAll('-', '');
  const token = `ogak_${secret}`;
  const prefix = `ogak_${secret.slice(0, 6)}…`;
  const [row] = await db
    .insert(apiKeys)
    .values({
      id,
      orgId: input.orgId ?? DEFAULT_ORG,
      name: input.name,
      prefix,
      subjectType: input.subjectType,
      subject: input.subject,
      budgetUsd: input.budgetUsd,
    })
    .returning();
  return { key: toApiKey(row), token };
}

// Tenant-scoped: org A cannot enable/disable org B's API key via a guessed id (disabling B's key is
// a denial-of-service; enabling a revoked one re-opens access) — P1 IDOR.
export async function setApiKeyEnabled(
  id: string,
  enabled: boolean,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await db
    .update(apiKeys)
    .set({ enabled })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)));
}

// Tenant-scoped: org A cannot delete org B's API key via a guessed id (P1 IDOR).
export async function deleteApiKey(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)));
}

// ─── Tool registry (the router's `tool` source) ───────────────────────────────
export type ToolPolicy = 'allow' | 'approval' | 'blocked';

export interface Tool {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  description: string;
  enabled: boolean;
  policy: ToolPolicy;
}

export async function listTools(orgId: string = DEFAULT_ORG): Promise<Tool[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(tools)
    .where(eq(tools.orgId, orgId))
    .orderBy(desc(tools.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    endpoint: r.endpoint,
    description: r.description,
    enabled: r.enabled,
    policy: (r.policy as ToolPolicy) ?? 'approval',
  }));
}

export async function createTool(input: {
  name: string;
  type: string;
  endpoint: string;
  description: string;
  policy?: ToolPolicy;
}): Promise<Tool> {
  await ensureOrgSchema();
  const [row] = await db
    .insert(tools)
    .values({
      id: `tool_${randomUUID().slice(0, 8)}`,
      policy: input.policy ?? 'approval',
      ...input,
    })
    .returning();
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    endpoint: row.endpoint,
    description: row.description,
    enabled: row.enabled,
    policy: (row.policy as ToolPolicy) ?? 'approval',
  };
}

export async function setToolEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(tools).set({ enabled }).where(eq(tools.id, id));
}

// Edit a registered tool's editable fields (name / endpoint / description). Only the provided keys
// are written, so a partial PATCH (e.g. just the description) leaves the rest untouched. Additive to
// the existing create/delete/enable/policy CRUD — the Tools surface needs field-level edit.
export async function updateTool(
  id: string,
  patch: { name?: string; endpoint?: string; description?: string },
): Promise<void> {
  await ensureOrgSchema();
  const set: Record<string, string> = {};
  if (typeof patch.name === 'string' && patch.name.trim()) set.name = patch.name.trim();
  if (typeof patch.endpoint === 'string') set.endpoint = patch.endpoint;
  if (typeof patch.description === 'string') set.description = patch.description;
  if (Object.keys(set).length === 0) return;
  await db.update(tools).set(set).where(eq(tools.id, id));
}

const TOOL_POLICIES = new Set<ToolPolicy>(['allow', 'approval', 'blocked']);
export async function setToolPolicy(id: string, policy: ToolPolicy): Promise<void> {
  await ensureOrgSchema();
  if (!TOOL_POLICIES.has(policy)) return;
  await db.update(tools).set({ policy }).where(eq(tools.id, id));
}

export async function deleteTool(id: string): Promise<void> {
  await db.delete(tools).where(eq(tools.id, id));
}

// ─── Org-wide settings (PER-TENANT) ───────────────────────────────────────────
// SECURITY WAVE 1 (P0): org_settings was a SINGLE shared row (id='org') across ALL tenants — one
// system prompt + one chat-pipeline allowlist for the whole fleet. It is now keyed by ORG: the `id`
// column IS the org id, one row per tenant. Every getter/setter takes `orgId` (defaults to
// DEFAULT_ORG so single-tenant callers are unchanged); the legacy 'org' row is re-homed onto the
// DEFAULT_ORG key by ensureOrgSchema. Reads/writes NEVER touch another tenant's config.
export async function getOrgSystemPrompt(orgId: string = DEFAULT_ORG): Promise<string> {
  await ensureOrgSchema();
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, orgId)).limit(1);
  return row?.systemPrompt ?? '';
}

export async function setOrgSystemPrompt(
  text: string,
  updatedBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureOrgSchema();
  await db
    .insert(orgSettings)
    .values({ id: orgId, systemPrompt: text, updatedBy })
    .onConflictDoUpdate({
      target: orgSettings.id,
      set: { systemPrompt: text, updatedBy, updatedAt: new Date() },
    });
}

// ─── Governed chat binding (CONSUMERS-BIND #166) ───────────────────────────────
// The org-default chat pipeline + the SET of pipelines a user may pick per-project. Admin-owned
// (routes gate with requireAdmin). Pure resolution/gating lives in chat-pipeline-policy.ts.

/** Read the org's chat-binding governance (default pipeline + available-for-chat allowlist). Per-tenant. */
export async function getChatBindingGovernance(
  orgId: string = DEFAULT_ORG,
): Promise<ChatBindingGovernance> {
  await ensureOrgSchema();
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, orgId)).limit(1);
  return {
    defaultChatPipelineId: row?.defaultChatPipelineId ?? null,
    allowlist: Array.isArray(row?.chatPipelineAllowlist) ? row.chatPipelineAllowlist : [],
  };
}

/** Set the org's chat-binding governance (admin-only; validated at the route). Upserts the per-tenant row. */
export async function setChatBindingGovernance(
  gov: ChatBindingGovernance,
  updatedBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureOrgSchema();
  const defaultChatPipelineId = gov.defaultChatPipelineId || null;
  const chatPipelineAllowlist = Array.from(new Set((gov.allowlist ?? []).filter(Boolean)));
  await db
    .insert(orgSettings)
    .values({ id: orgId, defaultChatPipelineId, chatPipelineAllowlist, updatedBy })
    .onConflictDoUpdate({
      target: orgSettings.id,
      set: { defaultChatPipelineId, chatPipelineAllowlist, updatedBy, updatedAt: new Date() },
    });
}

// ─── Custom roles (RBAC/ABAC overlay) ─────────────────────────────────────────
export interface CustomRole {
  id: string;
  name: string;
  description: string;
  basedOn: string;
  capabilities: string[];
}

// Tenant-scoped: operator-defined roles are per-org (defaults to DEFAULT_ORG). Without the filter
// listCustomRoles returned every tenant's roles — a cross-tenant RBAC leak.
export async function listCustomRoles(orgId: string = DEFAULT_ORG): Promise<CustomRole[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(customRoles)
    .where(eq(customRoles.orgId, orgId))
    .orderBy(desc(customRoles.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    basedOn: r.basedOn,
    capabilities: r.capabilities ?? [],
  }));
}

// Resolve a custom role by its name (the value carried in a user's session role). Returns null for
// built-in roles / unknown names. Used by the runtime permission resolver (lib/roles). Org-scoped
// (name+org, defaults to DEFAULT_ORG) so a user in org A can never resolve org B's role definition.
export async function getCustomRoleByName(
  name: string,
  orgId: string = DEFAULT_ORG,
): Promise<CustomRole | null> {
  if (!name) return null;
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(customRoles)
    .where(and(eq(customRoles.name, name), eq(customRoles.orgId, orgId)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    basedOn: r.basedOn,
    capabilities: r.capabilities ?? [],
  };
}

export async function createCustomRole(
  input: {
    name: string;
    description?: string;
    basedOn?: string;
    capabilities?: string[];
  },
  orgId: string = DEFAULT_ORG,
): Promise<CustomRole> {
  await ensureOrgSchema();
  const [row] = await db
    .insert(customRoles)
    .values({
      id: `role_${randomUUID().slice(0, 8)}`,
      orgId,
      name: input.name,
      description: input.description ?? '',
      basedOn: input.basedOn ?? 'viewer',
      capabilities: input.capabilities ?? [],
    })
    .returning();
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    basedOn: row.basedOn,
    capabilities: row.capabilities ?? [],
  };
}

// Org-scoped delete (id+org, defaults to DEFAULT_ORG) so a tenant can't delete another org's role.
export async function deleteCustomRole(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensureOrgSchema();
  await db.delete(customRoles).where(and(eq(customRoles.id, id), eq(customRoles.orgId, orgId)));
}

// ─── User-authored agents ─────────────────────────────────────────────────────
export interface CustomAgent {
  id: string;
  pipelineId: string | null;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  grounded: boolean;
  trigger: string;
  enabled: boolean;
}

function toCustomAgent(r: typeof customAgents.$inferSelect): CustomAgent {
  return {
    id: r.id,
    pipelineId: r.pipelineId,
    name: r.name,
    role: r.role,
    description: r.description,
    systemPrompt: r.systemPrompt,
    model: r.model,
    tools: r.tools ?? [],
    grounded: r.grounded,
    trigger: r.trigger,
    enabled: r.enabled,
  };
}

// Org-scoped: a tenant only ever sees/runs its own custom agents. Every read/write is constrained
// to the caller's org so agents authored in org A never leak into org B.
export async function listCustomAgents(orgId: string = DEFAULT_ORG): Promise<CustomAgent[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(customAgents)
    .where(eq(customAgents.orgId, orgId))
    .orderBy(desc(customAgents.createdAt));
  return rows.map(toCustomAgent);
}

/** Runtime/legacy agents explicitly bound to a pipeline, org-scoped for lifecycle safety. */
export async function listCustomAgentsByPipeline(
  pipelineId: string,
  orgId: string = DEFAULT_ORG,
): Promise<CustomAgent[]> {
  await ensureOrgSchema();
  const rows = await db
    .select()
    .from(customAgents)
    .where(and(eq(customAgents.pipelineId, pipelineId), eq(customAgents.orgId, orgId)))
    .orderBy(desc(customAgents.createdAt));
  return rows.map(toCustomAgent);
}

export async function getCustomAgent(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<CustomAgent | undefined> {
  await ensureOrgSchema();
  const [row] = await db
    .select()
    .from(customAgents)
    .where(and(eq(customAgents.id, id), eq(customAgents.orgId, orgId)))
    .limit(1);
  return row ? toCustomAgent(row) : undefined;
}

export async function createCustomAgent(
  input: {
    name: string;
    role?: string;
    description?: string;
    systemPrompt: string;
    model?: string;
    tools?: string[];
    grounded?: boolean;
    trigger?: string;
    pipelineId?: string | null;
  },
  orgId: string = DEFAULT_ORG,
): Promise<CustomAgent> {
  await ensureOrgSchema();
  const [row] = await db
    .insert(customAgents)
    .values({
      id: `agent_${randomUUID().slice(0, 8)}`,
      orgId,
      pipelineId: input.pipelineId ?? null,
      name: input.name,
      role: input.role || 'Custom',
      description: input.description || '',
      systemPrompt: input.systemPrompt,
      model: input.model || '',
      tools: input.tools ?? [],
      grounded: input.grounded ?? true,
      trigger: input.trigger || 'on-demand',
    })
    .returning();
  return toCustomAgent(row);
}

export async function setCustomAgentEnabled(
  id: string,
  enabled: boolean,
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureOrgSchema();
  await db
    .update(customAgents)
    .set({ enabled })
    .where(and(eq(customAgents.id, id), eq(customAgents.orgId, orgId)));
}

// Edit a user-authored agent in place. Only the provided fields are written, so a partial patch
// (e.g. just the instructions) leaves the rest untouched. Built-in agents aren't stored here.
export async function updateCustomAgent(
  id: string,
  patch: Partial<{
    name: string;
    role: string;
    description: string;
    systemPrompt: string;
    model: string;
    tools: string[];
    grounded: boolean;
    trigger: string;
    pipelineId: string | null;
  }>,
  orgId: string = DEFAULT_ORG,
): Promise<CustomAgent | undefined> {
  await ensureOrgSchema();
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.systemPrompt !== undefined) set.systemPrompt = patch.systemPrompt;
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.tools !== undefined) set.tools = patch.tools;
  if (patch.grounded !== undefined) set.grounded = patch.grounded;
  if (patch.trigger !== undefined) set.trigger = patch.trigger;
  if (patch.pipelineId !== undefined) set.pipelineId = patch.pipelineId;
  if (Object.keys(set).length === 0) return getCustomAgent(id, orgId);
  const [row] = await db
    .update(customAgents)
    .set(set)
    .where(and(eq(customAgents.id, id), eq(customAgents.orgId, orgId)))
    .returning();
  return row ? toCustomAgent(row) : undefined;
}

export async function deleteCustomAgent(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensureOrgSchema();
  await db.delete(customAgents).where(and(eq(customAgents.id, id), eq(customAgents.orgId, orgId)));
}
