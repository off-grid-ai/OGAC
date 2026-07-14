// ─── Connector execution — the ONE live query path (Builder Epic Phase 0) ─────
// The single place that opens a real connection to a connector's source (Postgres / MySQL /
// MSSQL / REST-HTTP) and reads from it. Extracted verbatim from store.ts:realRecordCount so the
// existing `syncConnector` sync AND Phase 1B's connector rule engine share ONE code path — a
// wrong or duplicated query path across two subsystems is a data-integrity hazard.
//
// SOLID: this module is I/O with a small, clean signature. It takes the connector's shape (type +
// endpoint), never the whole store; it returns `null` on any failure (unreachable / wrong dialect /
// bad response) so callers record honest zeros/misses and never fabricate a number or a row.
//
// Two entry points:
//   recordCount(type, endpoint)                 — count live rows (used by syncConnector).
//   execConnectorQuery(conn, {resource, op, …}) — run a READ against a specific resource/table
//                                                 (used by the connector-query rule engine).

// The minimal connector shape this module needs — just the dialect + where to reach it. Matches
// the fields on both the DB row and the `Connector` interface in store.ts, so either can be passed.
//
// `id` is optional: when present, the exec path resolves the connector's credential from the vault
// (via connector-secrets) at QUERY time and injects it — the SQL password into the connection URL,
// the REST api key as a Bearer header — so the stored endpoint stays credential-free. When absent
// (or the connector has no vaulted secret) the raw endpoint is used as-is, preserving already-seeded
// connectors that still carry inline creds. Nothing that works today breaks.
import {
  buildAuthPayload,
  buildModelListPayload,
  buildSearchReadPayload,
  parseAuthResult,
  parseModelListResult,
  parseOdooEndpoint,
  parseOdooInlinePassword,
  parseOdooLogin,
  parseSearchReadResult,
} from './odoo-rpc';

export interface ConnectorTarget {
  type: string;
  endpoint: string;
  id?: string;
}

// A connector target with its credential already resolved from the vault: the endpoint has any SQL
// password spliced in, and `authHeader` carries a Bearer header for REST when the connector has an
// api key. Produced by resolveTargetCreds; consumed by the dialect branches below.
interface ResolvedExecTarget {
  type: string;
  endpoint: string;
  authHeader: Record<string, string>;
  // The raw resolved secret, carried through for dialects that use the credential OUTSIDE the URL or
  // a Bearer header — Odoo's JSON-RPC password is a body argument, not a header or a DSN password.
  secret?: string;
}

// Resolve a target's credential from the vault (by `id`) into a ready-to-use exec target. Falls back
// to the raw endpoint + no header when there's no id / no vaulted secret / the vault is unreachable,
// so seeded connectors with inline creds keep working. Dynamic import breaks the exec↔secrets cycle.
async function resolveTargetCreds(conn: ConnectorTarget): Promise<ResolvedExecTarget> {
  const base: ResolvedExecTarget = { type: conn.type, endpoint: conn.endpoint, authHeader: {} };
  if (!conn.id) return base;
  try {
    const { resolveConnectorSecret } = await import('./connector-secrets');
    const { spliceCredential } = await import('./connector-policy');
    const secret = await resolveConnectorSecret(conn.id);
    if (!secret) return base;
    const dialect = detectDialect(conn.type, conn.endpoint);
    if (dialect === 'rest') return { ...base, authHeader: { authorization: `Bearer ${secret}` } };
    // Odoo: the credential is the JSON-RPC password (a body arg), so carry it as `secret` — NOT a
    // Bearer header (Odoo doesn't read one) and NOT spliced into the URL (odoo:// isn't a DSN).
    if (dialect === 'odoo') return { ...base, secret };
    // SQL dialects: splice the password into the connection URL (no-op if it already has one).
    return { ...base, endpoint: spliceCredential(conn.type, conn.endpoint, secret) };
  } catch {
    return base;
  }
}

// ─── Odoo JSON-RPC I/O helpers (thin over the pure odoo-rpc protocol layer) ───────────────────────
// One place that does the network for Odoo: POST a JSON-RPC envelope to <base>/jsonrpc and parse the
// body. Everything about the wire format lives in odoo-rpc.ts; this just runs fetch with a timeout
// and returns the parsed JSON (or null on any transport/HTTP/JSON failure — honest degrade).
const ODOO_TIMEOUT_MS = 5000;

async function odooRpc(base: string, payload: unknown): Promise<unknown> {
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/jsonrpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ODOO_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Resolve endpoint → {base, db}, login (userinfo), password (vaulted secret), then authenticate.
// Returns the connection context + uid on success, or null when the endpoint is unparseable, the
// password is absent, or auth fails — so every Odoo caller degrades to null uniformly (DRY).
interface OdooSession {
  base: string;
  db: string;
  uid: number;
  password: string;
}

async function odooAuthenticate(resolved: ResolvedExecTarget): Promise<OdooSession | null> {
  const parsed = parseOdooEndpoint(resolved.endpoint);
  if (!parsed) return null;
  const password = resolved.secret ?? '';
  if (!password) return null; // no credential → we won't guess one; honest miss
  const login = parseOdooLogin(resolved.endpoint);
  const authBody = await odooRpc(parsed.base, buildAuthPayload(parsed.db, login, password));
  const uid = parseAuthResult(authBody);
  if (uid === null) return null;
  return { base: parsed.base, db: parsed.db, uid, password };
}

// A READ request against a bound resource (table / path / object) on a connector.
export interface ConnectorQuery {
  resource: string; // table name (SQL) or path segment / key (REST)
  op?: 'read' | 'count'; // default 'read'
  limit?: number; // row cap for reads (default 100)
  params?: Record<string, unknown>; // reserved for equality filters (applied where safe)
}

// The result of a READ: the rows plus the row count that came back and the dialect used.
export type ConnectorDialect = 'postgres' | 'mysql' | 'mssql' | 'rest' | 'odoo';

export interface ConnectorQueryResult {
  rows: Record<string, unknown>[];
  count: number;
  dialect: ConnectorDialect;
}

// ─── Dialect detection (pure) ─────────────────────────────────────────────────
// Which live-query strategy applies to a (type, endpoint) pair. Kept pure + exported so the rule
// engine and tests can reason about bindings without opening a connection. Returns null when no
// strategy matches (non-DB connector, or endpoint scheme mismatched to the declared type).
export function detectDialect(type: string, endpoint: string): ConnectorDialect | null {
  const t = (type ?? '').toLowerCase();
  const e = endpoint ?? '';
  // Odoo takes precedence over the generic REST match: an Odoo connector's endpoint may be an
  // https:// URL (the `https://host/odoo?db=NAME` form), which would otherwise look like plain REST.
  // We match odoo ONLY when the type says so AND the endpoint parses to a valid {base, db} — a
  // scheme/type mismatch (odoo type, un-parseable endpoint) falls through to null, not a wrong dialect.
  if (t.includes('odoo') && parseOdooEndpoint(e) !== null) return 'odoo';
  if ((t.includes('postgres') || t === 'database') && e.startsWith('postgres')) return 'postgres';
  if (t.includes('mysql') && e.startsWith('mysql')) return 'mysql';
  if (t.includes('mssql') && e.startsWith('mssql')) return 'mssql';
  if ((t.includes('rest') || t.includes('http') || t.includes('api') || t.includes('crm')) && /^https?:/.test(e)) {
    return 'rest';
  }
  return null;
}

// Guard a caller-supplied SQL identifier (table/column). Live-query READs interpolate the resource
// name into the statement (bound params can't parameterize an identifier), so we allow only safe
// identifier characters incl. an optional schema qualifier. Rejects anything else → the caller
// gets null rather than an injection surface.
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
function safeIdentifier(name: string): string | null {
  return SAFE_IDENTIFIER.test(name) ? name : null;
}

// ─── recordCount — sum/estimate live rows (extracted from store.ts:realRecordCount) ──
// Returns the live row count for a database connector, or the record count for a REST source.
// Returns null for non-DB connectors or unreachable endpoints (caller records 0, never fakes).
// Behaviour is byte-for-byte the same as the original store.ts implementation.
export async function recordCount(type: string, endpoint: string): Promise<number | null> {
  const dialect = detectDialect(type, endpoint);
  if (dialect === 'postgres') {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: endpoint, connectionTimeoutMillis: 3000, max: 1 });
    try {
      const r = await pool.query('SELECT COALESCE(SUM(n_live_tup),0)::bigint AS n FROM pg_stat_user_tables');
      return Number(r.rows[0]?.n ?? 0);
    } catch { return null; } finally { await pool.end().catch(() => undefined); }
  }
  if (dialect === 'mysql') {
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
  if (dialect === 'mssql') {
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
  if (dialect === 'rest') {
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
  if (dialect === 'odoo') {
    // recordCount has no connector id → no vault; use any inline password from the endpoint userinfo.
    // Authenticate, then count the res.partner directory (the connector's representative record set —
    // the master customer/contact model every Odoo instance has). Null on any failure.
    const session = await odooAuthenticate({ type, endpoint, authHeader: {}, secret: parseOdooInlinePassword(endpoint) });
    if (!session) return null;
    const body = await odooRpc(
      session.base,
      buildSearchReadPayload({ db: session.db, uid: session.uid, password: session.password, model: 'res.partner', fields: ['id'], limit: 100000 }),
    );
    const rows = parseSearchReadResult(body);
    return rows === null ? null : rows.length;
  }
  return null;
}

// ─── execConnectorQuery — a READ against a specific resource on a connector ────
// Opens a live connection (via the same dialect detection as recordCount) and reads from the
// bound resource. This is what the connector-query STEP / router source calls once the rule engine
// has resolved a phrase → {connector, resource}. Returns null on any failure (unreachable / wrong
// dialect / unsafe identifier / bad REST response) so a wrong binding surfaces as a miss, never a
// fabricated row. READ-only by design: op is 'read' | 'count'; no write path exists here.
export async function execConnectorQuery(
  conn: ConnectorTarget,
  query: ConnectorQuery,
): Promise<ConnectorQueryResult | null> {
  const dialect = detectDialect(conn.type, conn.endpoint);
  if (!dialect) return null;
  const op = query.op ?? 'read';
  const limit = Math.max(1, Math.min(query.limit ?? 100, 1000));
  // Inject the vaulted credential (SQL password / REST bearer) at query time. Endpoint stays
  // credential-free on the row; the resolved copy is used only here and never persisted.
  const resolved = await resolveTargetCreds(conn);
  const endpoint = resolved.endpoint;

  if (dialect === 'postgres') {
    const table = safeIdentifier(query.resource);
    if (!table) return null;
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: endpoint, connectionTimeoutMillis: 3000, max: 1 });
    try {
      if (op === 'count') {
        const r = await pool.query(`SELECT COUNT(*)::bigint AS n FROM ${table}`);
        return { rows: [{ count: Number(r.rows[0]?.n ?? 0) }], count: Number(r.rows[0]?.n ?? 0), dialect };
      }
      const r = await pool.query(`SELECT * FROM ${table} LIMIT ${limit}`);
      return { rows: r.rows as Record<string, unknown>[], count: r.rowCount ?? r.rows.length, dialect };
    } catch { return null; } finally { await pool.end().catch(() => undefined); }
  }

  if (dialect === 'mysql') {
    const table = safeIdentifier(query.resource);
    if (!table) return null;
    try {
      const mysql = await import('mysql2/promise');
      const c = await mysql.createConnection(endpoint);
      try {
        if (op === 'count') {
          const [rows] = await c.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
          const n = Number((rows as { n: number }[])[0]?.n ?? 0);
          return { rows: [{ count: n }], count: n, dialect };
        }
        const [rows] = await c.query(`SELECT * FROM \`${table}\` LIMIT ${limit}`);
        const arr = rows as Record<string, unknown>[];
        return { rows: arr, count: arr.length, dialect };
      } finally { await c.end(); }
    } catch { return null; }
  }

  if (dialect === 'mssql') {
    const table = safeIdentifier(query.resource);
    if (!table) return null;
    try {
      const mssqlMod = await import('mssql');
      const mssql = mssqlMod.default ?? mssqlMod;
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
        if (op === 'count') {
          const res = await pool.request().query(`SELECT COUNT(*) AS n FROM ${table}`);
          const n = Number(res.recordset?.[0]?.n ?? 0);
          return { rows: [{ count: n }], count: n, dialect };
        }
        const res = await pool.request().query(`SELECT TOP ${limit} * FROM ${table}`);
        const arr = (res.recordset ?? []) as Record<string, unknown>[];
        return { rows: arr, count: arr.length, dialect };
      } finally { await pool.close(); }
    } catch { return null; }
  }

  // REST: fetch the endpoint, optionally drilling into a keyed sub-array by `resource`
  // (json-server style {accounts:[…]} → resource='accounts'). A top-level array is returned as-is.
  if (dialect === 'rest') {
    try {
      const base = endpoint.replace(/\/$/, '');
      const headers = resolved.authHeader;
      // Prefer a resource-scoped path (…/accounts); fall back to the base if it 404s.
      const url = query.resource ? `${base}/${encodeURIComponent(query.resource)}` : base;
      let body: unknown;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        body = await r.json();
      } else {
        const rb = await fetch(base, { headers, signal: AbortSignal.timeout(3000) });
        if (!rb.ok) return null;
        const full = await rb.json();
        body = full && typeof full === 'object' && query.resource
          ? (full as Record<string, unknown>)[query.resource]
          : full;
      }
      let arr: Record<string, unknown>[];
      if (Array.isArray(body)) {
        arr = body as Record<string, unknown>[];
      } else if (body && typeof body === 'object') {
        // Object body with the resource key holding the array, else empty.
        const v = (body as Record<string, unknown>)[query.resource];
        arr = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
      } else {
        arr = [];
      }
      const rows = arr.slice(0, limit);
      if (op === 'count') return { rows: [{ count: arr.length }], count: arr.length, dialect };
      return { rows, count: arr.length, dialect };
    } catch { return null; }
  }

  // Odoo: authenticate, then search_read the model named by `query.resource` (e.g. res.partner).
  // Returns null on any failure — unparseable endpoint, missing credential, auth reject, or an Odoo
  // {error} envelope — so a bad binding surfaces as a miss, never a fabricated record.
  if (dialect === 'odoo') {
    if (!query.resource) return null;
    const session = await odooAuthenticate(resolved);
    if (!session) return null;
    // For a count we still read the rows (bounded) and count them — Odoo's search_count is a separate
    // method; keeping to search_read is one code path and honest (the count is of what we can read).
    const body = await odooRpc(
      session.base,
      buildSearchReadPayload({
        db: session.db,
        uid: session.uid,
        password: session.password,
        model: query.resource,
        limit,
      }),
    );
    const rows = parseSearchReadResult(body);
    if (rows === null) return null;
    if (op === 'count') return { rows: [{ count: rows.length }], count: rows.length, dialect };
    return { rows, count: rows.length, dialect };
  }

  return null;
}

// ─── testConnection — a cheap live probe (SELECT 1 / REST root) ────────────────
// Opens a connection with the vaulted credential injected and runs the lightest possible check:
// `SELECT 1` for SQL, a HEAD/GET of the base URL for REST. Returns an honest pass/fail + a short
// message the UI shows inline — the operator confirms the connector actually reaches its source
// before relying on it. Never throws; a failure is `{ ok: false, message }`, never an exception.
export interface ConnectionTestResult {
  ok: boolean;
  dialect: ConnectorDialect | null;
  message: string;
}

export async function testConnection(conn: ConnectorTarget): Promise<ConnectionTestResult> {
  const dialect = detectDialect(conn.type, conn.endpoint);
  if (!dialect) {
    return { ok: false, dialect: null, message: 'This connector type cannot be queried live yet.' };
  }
  const resolved = await resolveTargetCreds(conn);
  const endpoint = resolved.endpoint;

  try {
    if (dialect === 'postgres') {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: endpoint, connectionTimeoutMillis: 4000, max: 1 });
      try {
        await pool.query('SELECT 1');
        return { ok: true, dialect, message: 'Connected — the database responded.' };
      } finally { await pool.end().catch(() => undefined); }
    }
    if (dialect === 'mysql') {
      const mysql = await import('mysql2/promise');
      const c = await mysql.createConnection(endpoint);
      try {
        await c.query('SELECT 1');
        return { ok: true, dialect, message: 'Connected — the database responded.' };
      } finally { await c.end(); }
    }
    if (dialect === 'mssql') {
      const mssqlMod = await import('mssql');
      const mssql = mssqlMod.default ?? mssqlMod;
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
        await pool.request().query('SELECT 1 AS n');
        return { ok: true, dialect, message: 'Connected — the database responded.' };
      } finally { await pool.close(); }
    }
    if (dialect === 'odoo') {
      const session = await odooAuthenticate(resolved);
      if (session) {
        return { ok: true, dialect, message: `Connected — Odoo authenticated (uid ${session.uid}).` };
      }
      // Distinguish "reached but rejected" (no credential / bad login) from a transport failure by
      // re-checking the parse: an unparseable endpoint is a config error, otherwise it's auth.
      if (!parseOdooEndpoint(resolved.endpoint)) {
        return { ok: false, dialect, message: 'The Odoo endpoint could not be parsed (need a database).' };
      }
      return { ok: false, dialect, message: 'Odoo rejected the credentials or was unreachable.' };
    }
    // rest
    const r = await fetch(endpoint.replace(/\/$/, ''), {
      headers: resolved.authHeader,
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) return { ok: true, dialect, message: `Connected — the API returned ${r.status}.` };
    return { ok: false, dialect, message: `The API responded ${r.status} ${r.statusText}.` };
  } catch (e) {
    const code = (e as { cause?: { code?: string } })?.cause?.code;
    const msg = code ?? (e as Error)?.message ?? 'connection failed';
    return { ok: false, dialect, message: `Could not connect: ${msg}.` };
  }
}

// ─── listResources — enumerate the tables/objects the user can bind to ─────────
// SQL: read information_schema for the base (non-system) tables so the user PICKS a table instead of
// hand-typing a raw resource string. REST: read the base URL and surface the top-level array keys
// (json-server style {accounts:[…], loans:[…]} → ['accounts','loans']). Returns null on failure so
// the caller degrades to manual entry rather than showing a fake list.
export async function listResources(conn: ConnectorTarget): Promise<string[] | null> {
  const dialect = detectDialect(conn.type, conn.endpoint);
  if (!dialect) return null;
  const resolved = await resolveTargetCreds(conn);
  const endpoint = resolved.endpoint;

  try {
    if (dialect === 'postgres') {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: endpoint, connectionTimeoutMillis: 4000, max: 1 });
      try {
        const r = await pool.query(
          `SELECT table_schema, table_name FROM information_schema.tables
           WHERE table_type = 'BASE TABLE'
             AND table_schema NOT IN ('pg_catalog','information_schema')
           ORDER BY table_schema, table_name LIMIT 500`,
        );
        return r.rows.map((row) =>
          row.table_schema === 'public' ? String(row.table_name) : `${row.table_schema}.${row.table_name}`,
        );
      } finally { await pool.end().catch(() => undefined); }
    }
    if (dialect === 'mysql') {
      const mysql = await import('mysql2/promise');
      const c = await mysql.createConnection(endpoint);
      try {
        const [rows] = await c.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = DATABASE() ORDER BY table_name LIMIT 500`,
        );
        return (rows as { table_name?: string; TABLE_NAME?: string }[]).map(
          (row) => String(row.table_name ?? row.TABLE_NAME),
        );
      } finally { await c.end(); }
    }
    if (dialect === 'mssql') {
      const mssqlMod = await import('mssql');
      const mssql = mssqlMod.default ?? mssqlMod;
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
          `SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        );
        return (res.recordset ?? []).map((row: { TABLE_SCHEMA: string; TABLE_NAME: string }) =>
          row.TABLE_SCHEMA === 'dbo' ? String(row.TABLE_NAME) : `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`,
        );
      } finally { await pool.close(); }
    }
    if (dialect === 'odoo') {
      const session = await odooAuthenticate(resolved);
      if (!session) return null;
      const body = await odooRpc(
        session.base,
        buildModelListPayload({ db: session.db, uid: session.uid, password: session.password }),
      );
      return parseModelListResult(body); // null on error → caller degrades to manual entry
    }
    // rest — surface the top-level array keys (json-server collections) or [] for a bare array.
    const r = await fetch(endpoint.replace(/\/$/, ''), {
      headers: resolved.authHeader,
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const body = await r.json();
    if (Array.isArray(body)) return [];
    if (body && typeof body === 'object') {
      return Object.entries(body as Record<string, unknown>)
        .filter(([, v]) => Array.isArray(v))
        .map(([k]) => k);
    }
    return [];
  } catch {
    return null;
  }
}
