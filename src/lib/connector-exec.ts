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
export interface ConnectorTarget {
  type: string;
  endpoint: string;
}

// A READ request against a bound resource (table / path / object) on a connector.
export interface ConnectorQuery {
  resource: string; // table name (SQL) or path segment / key (REST)
  op?: 'read' | 'count'; // default 'read'
  limit?: number; // row cap for reads (default 100)
  params?: Record<string, unknown>; // reserved for equality filters (applied where safe)
}

// The result of a READ: the rows plus the row count that came back and the dialect used.
export interface ConnectorQueryResult {
  rows: Record<string, unknown>[];
  count: number;
  dialect: 'postgres' | 'mysql' | 'mssql' | 'rest';
}

// ─── Dialect detection (pure) ─────────────────────────────────────────────────
// Which live-query strategy applies to a (type, endpoint) pair. Kept pure + exported so the rule
// engine and tests can reason about bindings without opening a connection. Returns null when no
// strategy matches (non-DB connector, or endpoint scheme mismatched to the declared type).
export function detectDialect(
  type: string,
  endpoint: string,
): 'postgres' | 'mysql' | 'mssql' | 'rest' | null {
  const t = (type ?? '').toLowerCase();
  const e = endpoint ?? '';
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

  if (dialect === 'postgres') {
    const table = safeIdentifier(query.resource);
    if (!table) return null;
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: conn.endpoint, connectionTimeoutMillis: 3000, max: 1 });
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
      const c = await mysql.createConnection(conn.endpoint);
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
      const u = new URL(conn.endpoint);
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
      const base = conn.endpoint.replace(/\/$/, '');
      // Prefer a resource-scoped path (…/accounts); fall back to the base if it 404s.
      const url = query.resource ? `${base}/${encodeURIComponent(query.resource)}` : base;
      let body: unknown;
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        body = await r.json();
      } else {
        const rb = await fetch(base, { signal: AbortSignal.timeout(3000) });
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

  return null;
}
