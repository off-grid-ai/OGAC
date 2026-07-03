// Persistence for the node↔console state — real Postgres via Drizzle. Same exported
// signatures the routes/UI already use (now async). Schema lives in src/db/schema.ts.
import { randomUUID } from 'crypto';
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
import type { CheckResult } from '@/lib/checks';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { emitSpan } from '@/lib/otel';
import { shipAudit } from '@/lib/siem';

// Additive columns/tables for Wave-2 org/connector parity. Created idempotently on first use so
// the deploy needs no migration step (matches the chat module's ensure* pattern). Memoized.
let orgEnsure: Promise<void> | null = null;
export async function ensureOrgSchema(): Promise<void> {
  if (orgEnsure) return orgEnsure;
  orgEnsure = (async (): Promise<void> => {
    await db.execute(sql`ALTER TABLE tools ADD COLUMN IF NOT EXISTS policy text NOT NULL DEFAULT 'approval';`);
    await db.execute(sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS endpoint text NOT NULL DEFAULT '';`);
    await db.execute(sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS auth text NOT NULL DEFAULT 'none';`);
    await db.execute(sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';`);
    await db.execute(sql`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS org_settings (
        id text PRIMARY KEY DEFAULT 'org', system_prompt text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL DEFAULT '');
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_roles (
        id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
        based_on text NOT NULL DEFAULT 'viewer', capabilities jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now());
    `);
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

export async function listDevices(): Promise<Device[]> {
  const rows = await db.select().from(devices);
  return rows.map(toDevice);
}

export async function getDevice(id: string): Promise<Device | undefined> {
  const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  return row ? toDevice(row) : undefined;
}

export async function createEnrollmentToken(role: string): Promise<EnrollmentToken> {
  const [row] = await db
    .insert(enrollmentTokens)
    .values({ token: `enr_${randomUUID().slice(0, 12)}`, role })
    .returning();
  return { token: row.token, role: row.role, createdAt: iso(row.createdAt), used: row.used };
}

export async function enrollDevice(
  token: string,
  name: string,
  os: DeviceOS,
): Promise<Device | null> {
  const [rec] = await db
    .select()
    .from(enrollmentTokens)
    .where(eq(enrollmentTokens.token, token))
    .limit(1);
  if (!rec || rec.used) return null;
  await db.update(enrollmentTokens).set({ used: true }).where(eq(enrollmentTokens.token, token));
  const policy = await getOrgPolicy();
  const [row] = await db
    .insert(devices)
    .values({
      id: `dev_${randomUUID().slice(0, 6)}`,
      name,
      os,
      role: rec.role,
      status: 'online',
      lastSeen: 'just now',
      policyVersion: policy.version,
    })
    .returning();
  return toDevice(row);
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
export async function pullPolicyForDevice(id: string): Promise<PolicyBundle | null> {
  const device = await getDevice(id);
  if (!device) return null;
  const policy = await getOrgPolicy();
  await db
    .update(devices)
    .set({ policyVersion: policy.version, status: 'online', lastSeen: 'just now' })
    .where(eq(devices.id, id));
  return policy;
}

export async function appendAudit(
  deviceId: string,
  events: Omit<AuditEvent, 'id' | 'deviceId'>[],
): Promise<number> {
  await db
    .update(devices)
    .set({ status: 'online', lastSeen: 'just now' })
    .where(eq(devices.id, deviceId));
  if (events.length === 0) return 0;
  const rows = events.map((e) => ({
    id: randomUUID(),
    deviceId,
    ts: new Date(e.ts),
    model: e.model,
    tokens: e.tokens,
    leftDevice: e.leftDevice,
    tool: e.tool,
    outcome: e.outcome,
    latencyMs: e.latencyMs ?? 200 + Math.floor(Math.random() * 1800),
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

export async function listAudit(opts?: {
  deviceId?: string;
  limit?: number;
}): Promise<AuditEvent[]> {
  const limit = opts?.limit ?? 100;
  const base = db.select().from(auditEvents).orderBy(desc(auditEvents.ts)).limit(limit);
  const rows = opts?.deviceId
    ? await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.deviceId, opts.deviceId))
        .orderBy(desc(auditEvents.ts))
        .limit(limit)
    : await base;
  return rows.map(toAudit);
}

export async function queueKill(deviceId: string): Promise<Command | null> {
  const device = await getDevice(deviceId);
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

export async function listUsers(): Promise<ConsoleUser[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users);
}

// SCIM provisioning: create (or upsert by email) a console user. Idempotent on email so a repeated
// SCIM POST is safe. Returns the row in ConsoleUser shape.
export async function createConsoleUser(input: {
  email: string;
  name?: string | null;
  role?: string;
}): Promise<ConsoleUser> {
  const [existing] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(users)
    .values({ email: input.email, name: input.name ?? null, role: input.role ?? 'viewer' })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
  return row;
}

export async function setUserRole(id: string, role: string): Promise<ConsoleUser | null> {
  const [row] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
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
async function realRecordCount(type: string, endpoint: string): Promise<number | null> {
  const t = type.toLowerCase();
  // Postgres: sum live rows across user tables.
  if ((t.includes('postgres') || t === 'database') && endpoint.startsWith('postgres')) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: endpoint, connectionTimeoutMillis: 3000, max: 1 });
    try {
      const r = await pool.query('SELECT COALESCE(SUM(n_live_tup),0)::bigint AS n FROM pg_stat_user_tables');
      return Number(r.rows[0]?.n ?? 0);
    } catch { return null; } finally { await pool.end().catch(() => undefined); }
  }
  // MySQL: sum table rows from information_schema.
  if (t.includes('mysql') && endpoint.startsWith('mysql')) {
    try {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection(endpoint);
      try {
        const [rows] = await conn.query(
          'SELECT COALESCE(SUM(table_rows),0) AS n FROM information_schema.tables WHERE table_schema = DATABASE()',
        );
        return Number((rows as { n: number }[])[0]?.n ?? 0);
      } finally { await conn.end(); }
    } catch { return null; }
  }
  // MSSQL: sum row counts across user tables (sys.dm_db_partition_stats).
  if (t.includes('mssql') && endpoint.startsWith('mssql')) {
    try {
      const mssqlMod = await import('mssql');
      const mssql = mssqlMod.default ?? mssqlMod;
      // Parse mssql://user:pass@host:port/db into a config (URL form is unreliable for mssql).
      const u = new URL(endpoint);
      const pool = await mssql.connect({
        server: u.hostname,
        port: Number(u.port || 1433),
        user: decodeURIComponent(u.username) || 'sa',
        password: decodeURIComponent(u.password) || process.env.OFFGRID_ERP_PASSWORD || '',
        database: u.pathname.replace(/^\//, '') || 'master',
        options: { encrypt: false, trustServerCertificate: true },
        connectionTimeout: 4000,
      });
      try {
        const res = await pool.request().query(
          'SELECT COALESCE(SUM(row_count),0) AS n FROM sys.dm_db_partition_stats WHERE index_id IN (0,1)',
        );
        return Number(res.recordset?.[0]?.n ?? 0);
      } finally { await pool.close(); }
    } catch { return null; }
  }
  // REST/HTTP (e.g. CRM): GET the endpoint and count records. Supports a top-level array,
  // or an object of arrays (json-server style: {accounts:[…], contacts:[…]}) → sum of lengths.
  if ((t.includes('rest') || t.includes('http') || t.includes('api') || t.includes('crm')) && /^https?:/.test(endpoint)) {
    try {
      const r = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return null;
      const body = await r.json();
      if (Array.isArray(body)) return body.length;
      if (body && typeof body === 'object') {
        return Object.values(body).reduce<number>((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
      }
      return 0;
    } catch { return null; }
  }
  return null;
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

export async function deleteConnector(id: string): Promise<void> {
  await db.delete(ingestJobs).where(eq(ingestJobs.connectorId, id));
  await db.delete(connectors).where(eq(connectors.id, id));
}

export async function syncConnector(id: string): Promise<IngestJob | null> {
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

export async function listIngestJobs(limit = 20): Promise<IngestJob[]> {
  const rows = await db.select().from(ingestJobs).orderBy(desc(ingestJobs.startedAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    connectorId: r.connectorId,
    connectorName: r.connectorName,
    status: r.status,
    records: r.records,
    startedAt: iso(r.startedAt),
  }));
}

export async function listMaskingRules(): Promise<MaskingRule[]> {
  const rows = await db.select().from(maskingRules).orderBy(desc(maskingRules.createdAt));
  return rows.map((r) => ({ id: r.id, kind: r.kind, action: r.action, enabled: r.enabled }));
}

export async function createMaskingRule(kind: string, action: string): Promise<MaskingRule> {
  const [row] = await db
    .insert(maskingRules)
    .values({ id: `msk_${randomUUID().slice(0, 6)}`, kind, action })
    .returning();
  return { id: row.id, kind: row.kind, action: row.action, enabled: row.enabled };
}

export async function setMaskingRuleEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(maskingRules).set({ enabled }).where(eq(maskingRules.id, id));
}

export async function listDatasets(orgId: string = DEFAULT_ORG): Promise<Dataset[]> {
  const rows = await db.select().from(datasets).where(eq(datasets.orgId, orgId)).orderBy(desc(datasets.updatedAt));
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
    plan: r.plan,
    enabledModules: r.enabledModules,
    createdAt: iso(r.createdAt),
  };
}

export async function listTenants(): Promise<Tenant[]> {
  const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  return rows.map(toTenant);
}

export async function createTenant(
  name: string,
  plan: string,
  enabledModules: string[],
): Promise<Tenant> {
  const [row] = await db
    .insert(tenants)
    .values({ id: `org_${randomUUID().slice(0, 6)}`, name, plan, enabledModules })
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

export async function listAbacRules(): Promise<AbacRule[]> {
  const rows = await db.select().from(abacRules).orderBy(desc(abacRules.createdAt));
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

export async function createAbacRule(rule: Omit<AbacRule, 'id'>): Promise<AbacRule> {
  const [row] = await db
    .insert(abacRules)
    .values({ id: `abac_${randomUUID().slice(0, 6)}`, ...rule })
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

export async function deleteAbacRule(id: string): Promise<void> {
  await db.delete(abacRules).where(eq(abacRules.id, id));
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
export async function evaluateAbac(
  ctx: AbacContext,
): Promise<{ allow: boolean; matched: AbacRule[] }> {
  const rules = await listAbacRules();
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

export async function listRoutingRules(): Promise<RoutingRule[]> {
  const rows = await db.select().from(routingRules).orderBy(routingRules.priority);
  return rows.map(toRoutingRule);
}

export async function createRoutingRule(
  input: Omit<RoutingRule, 'id' | 'enabled'>,
): Promise<RoutingRule> {
  const [row] = await db
    .insert(routingRules)
    .values({ id: `route_${randomUUID().slice(0, 8)}`, ...input })
    .returning();
  return toRoutingRule(row);
}

export async function setRoutingRuleEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(routingRules).set({ enabled }).where(eq(routingRules.id, id));
}

export async function deleteRoutingRule(id: string): Promise<void> {
  await db.delete(routingRules).where(eq(routingRules.id, id));
}

export interface RoutingDecision {
  action: 'local' | 'cloud' | 'block';
  effective: 'local' | 'cloud' | 'block';
  model: string | null;
  fallback: string | null;
  matched: string | null;
  reason: string;
}

// Evaluate where a request runs: first enabled rule (by ascending priority) whose condition
// matches wins. The org egress switch is the master leash — a `cloud` action with egress off is
// downgraded to `block`. No match → local (the safe default).
export async function evaluateRouting(ctx: {
  attributes: Record<string, string>;
}): Promise<RoutingDecision> {
  const [rules, policy] = await Promise.all([listRoutingRules(), getOrgPolicy()]);
  const abacCtx: AbacContext = { role: '*', resource: '*', attributes: ctx.attributes };
  const hit = rules.find((r) => r.enabled && ruleMatches(routeAsAbac(r), abacCtx));
  if (!hit) {
    return {
      action: 'local',
      effective: 'local',
      model: null,
      fallback: null,
      matched: null,
      reason: 'no rule matched; defaulted to local',
    };
  }
  const action = hit.action as RoutingDecision['action'];
  const leashed = action === 'cloud' && !policy.egressAllowed;
  return {
    action,
    effective: leashed ? 'block' : action,
    model: hit.model || null,
    fallback: hit.fallback || null,
    matched: hit.name,
    reason: leashed ? `${hit.name} → cloud, but org egress is OFF (leashed to block)` : hit.name,
  };
}

// Reuse the ABAC matcher: a routing rule's attribute/operator/value is an AbacRule shape.
function routeAsAbac(r: RoutingRule): AbacRule {
  return {
    id: r.id,
    role: '*',
    resource: '*',
    attribute: r.attribute,
    operator: r.operator,
    value: r.value,
    effect: 'allow',
  };
}

// ─── Feature flags (runtime toggles) ───────────────────────────────────────────
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
}

export async function listFlags(): Promise<FeatureFlag[]> {
  const rows = await db.select().from(featureFlags).orderBy(featureFlags.key);
  return rows.map((r) => ({ key: r.key, enabled: r.enabled, description: r.description }));
}

export async function setFlag(key: string, enabled: boolean, description = ''): Promise<void> {
  await db
    .insert(featureFlags)
    .values({ key, enabled, description })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt: new Date() } });
}

// Runtime check with a default. Falls back to the default when the flag is unset.
export async function isEnabled(key: string, fallback = false): Promise<boolean> {
  const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  return row ? row.enabled : fallback;
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

export async function listPrompts(): Promise<Prompt[]> {
  const rows = await db.select().from(prompts).orderBy(desc(prompts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    latestVersion: r.latestVersion,
  }));
}

export async function listPromptVersions(promptId: string): Promise<PromptVersion[]> {
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

export async function createPrompt(name: string, description: string): Promise<Prompt> {
  const [row] = await db
    .insert(prompts)
    .values({ id: `pr_${randomUUID().slice(0, 8)}`, name, description })
    .returning();
  return { id: row.id, name: row.name, description: row.description, latestVersion: 0 };
}

// Publish a new version of a prompt (immutable history; bumps the prompt's latestVersion).
export async function addPromptVersion(
  promptId: string,
  body: string,
  label: string,
): Promise<PromptVersion | null> {
  const [p] = await db.select().from(prompts).where(eq(prompts.id, promptId)).limit(1);
  if (!p) return null;
  const version = p.latestVersion + 1;
  const [row] = await db
    .insert(promptVersions)
    .values({ id: `pv_${randomUUID().slice(0, 8)}`, promptId, version, body, label })
    .returning();
  await db.update(prompts).set({ latestVersion: version }).where(eq(prompts.id, promptId));
  return { id: row.id, version, body, label, createdAt: iso(row.createdAt) };
}

export async function deletePrompt(id: string): Promise<void> {
  await db.delete(promptVersions).where(eq(promptVersions.promptId, id));
  await db.delete(prompts).where(eq(prompts.id, id));
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

export async function listGovernance(): Promise<GovernanceItem[]> {
  const rows = await db.select().from(governanceItems).orderBy(governanceItems.kind);
  return rows.map(toGovernance);
}

export async function createGovernance(input: Omit<GovernanceItem, 'id'>): Promise<GovernanceItem> {
  const [row] = await db
    .insert(governanceItems)
    .values({ id: `gov_${randomUUID().slice(0, 8)}`, ...input })
    .returning();
  return toGovernance(row);
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
  const secret = randomUUID().replace(/-/g, '');
  const token = `ogk_${secret}`;
  const prefix = `ogk_${secret.slice(0, 6)}…`;
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

export async function setApiKeyEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(apiKeys).set({ enabled }).where(eq(apiKeys.id, id));
}

export async function deleteApiKey(id: string): Promise<void> {
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
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
  const rows = await db.select().from(tools).where(eq(tools.orgId, orgId)).orderBy(desc(tools.createdAt));
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
    .values({ id: `tool_${randomUUID().slice(0, 8)}`, policy: input.policy ?? 'approval', ...input })
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

const TOOL_POLICIES: ToolPolicy[] = ['allow', 'approval', 'blocked'];
export async function setToolPolicy(id: string, policy: ToolPolicy): Promise<void> {
  await ensureOrgSchema();
  if (!TOOL_POLICIES.includes(policy)) return;
  await db.update(tools).set({ policy }).where(eq(tools.id, id));
}

export async function deleteTool(id: string): Promise<void> {
  await db.delete(tools).where(eq(tools.id, id));
}

// ─── Org-wide settings (singleton) ────────────────────────────────────────────
export async function getOrgSystemPrompt(): Promise<string> {
  await ensureOrgSchema();
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, 'org')).limit(1);
  return row?.systemPrompt ?? '';
}

export async function setOrgSystemPrompt(text: string, updatedBy: string): Promise<void> {
  await ensureOrgSchema();
  await db
    .insert(orgSettings)
    .values({ id: 'org', systemPrompt: text, updatedBy })
    .onConflictDoUpdate({
      target: orgSettings.id,
      set: { systemPrompt: text, updatedBy, updatedAt: new Date() },
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

export async function listCustomRoles(): Promise<CustomRole[]> {
  await ensureOrgSchema();
  const rows = await db.select().from(customRoles).orderBy(desc(customRoles.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    basedOn: r.basedOn,
    capabilities: r.capabilities ?? [],
  }));
}

// Resolve a custom role by its name (the value carried in a user's session role). Returns null for
// built-in roles / unknown names. Used by the runtime permission resolver (lib/roles).
export async function getCustomRoleByName(name: string): Promise<CustomRole | null> {
  if (!name) return null;
  await ensureOrgSchema();
  const rows = await db.select().from(customRoles).where(eq(customRoles.name, name)).limit(1);
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

export async function createCustomRole(input: {
  name: string;
  description?: string;
  basedOn?: string;
  capabilities?: string[];
}): Promise<CustomRole> {
  await ensureOrgSchema();
  const [row] = await db
    .insert(customRoles)
    .values({
      id: `role_${randomUUID().slice(0, 8)}`,
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

export async function deleteCustomRole(id: string): Promise<void> {
  await ensureOrgSchema();
  await db.delete(customRoles).where(eq(customRoles.id, id));
}

// ─── User-authored agents ─────────────────────────────────────────────────────
export interface CustomAgent {
  id: string;
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

export async function listCustomAgents(): Promise<CustomAgent[]> {
  const rows = await db.select().from(customAgents).orderBy(desc(customAgents.createdAt));
  return rows.map(toCustomAgent);
}

export async function getCustomAgent(id: string): Promise<CustomAgent | undefined> {
  const [row] = await db.select().from(customAgents).where(eq(customAgents.id, id)).limit(1);
  return row ? toCustomAgent(row) : undefined;
}

export async function createCustomAgent(input: {
  name: string;
  role?: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  tools?: string[];
  grounded?: boolean;
  trigger?: string;
}): Promise<CustomAgent> {
  const [row] = await db
    .insert(customAgents)
    .values({
      id: `agent_${randomUUID().slice(0, 8)}`,
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

export async function setCustomAgentEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(customAgents).set({ enabled }).where(eq(customAgents.id, id));
}

export async function deleteCustomAgent(id: string): Promise<void> {
  await db.delete(customAgents).where(eq(customAgents.id, id));
}
