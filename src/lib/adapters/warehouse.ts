// ─── Warehouse port + ClickHouse adapter ───────────────────────────────────
// The one live path to the analytical warehouse (ClickHouse). SOLID: this module is pure I/O — it
// opens the HTTP connection and reads; EVERY SQL string, parse, guard, and computation is delegated
// to the zero-IO src/lib/warehouse-model.ts. Graceful-degrade like the other adapters
// (src/lib/adapters/services.ts, pii.ts): health() returns false and list/stats return []/null when
// the box is unreachable — never throws an uncaught error into a route handler.

import type { AdapterMeta } from './types';
import {
  buildListTablesSql,
  buildSampleSql,
  buildTableStatsSql,
  clampLimit,
  freshnessOf,
  guardReadOnlySql,
  isSafeIdentifier,
  parseClickHouseJson,
  toTableSummary,
  withJsonFormat,
  type Freshness,
  type ParsedClickHouse,
  type TableSummary,
} from '@/lib/warehouse-model';

const env = process.env;

// Env config, read lazily on each call so a test can point OFFGRID_WAREHOUSE_URL at the live LAN box
// before invoking (env is not captured at import time).
function warehouseConfig() {
  return {
    url: (env.OFFGRID_WAREHOUSE_URL || 'http://127.0.0.1:8941').replace(/\/$/, ''),
    user: env.OFFGRID_WAREHOUSE_USER || 'warehouse',
    password: env.OFFGRID_WAREHOUSE_PASSWORD || 'warehouse',
  };
}

const QUERY_TIMEOUT_MS = 8000;

// Per-table stats returned by tableStats(). rows/bytes are the real on-disk figures; freshness is
// the age of the latest data part.
export interface TableStats {
  name: string;
  database?: string;
  rows: number;
  bytes: number;
  engine: string;
  freshness: Freshness;
}

export interface WarehousePort {
  meta: AdapterMeta;
  health(): Promise<boolean>;
  listTables(): Promise<TableSummary[]>;
  tableStats(table: string): Promise<TableStats | null>;
  sample(table: string, limit?: number): Promise<ParsedClickHouse | null>;
  // Operator-typed READ-ONLY SQL. Returns the parsed rows, or a rejection reason (guard failure /
  // engine error) — never throws.
  query(sql: string): Promise<{ ok: true; result: ParsedClickHouse } | { ok: false; reason: string }>;
}

// Run a statement over the ClickHouse HTTP interface. POST the SQL as the body (GET query-string has
// length limits and logs the SQL); auth via the X-ClickHouse-User/Key headers. Returns the raw text
// so the caller parses with the pure parser; throws on a transport/HTTP error so callers can degrade.
async function runSql(sql: string): Promise<string> {
  const { url, user, password } = warehouseConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      'X-ClickHouse-User': user,
      'X-ClickHouse-Key': password,
    },
    body: sql,
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`clickhouse ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return res.text();
}

// Flatten a thrown value to a diagnosable one-liner; fetch failures hide the errno on err.cause.code.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return code ? `${err.message} (cause: ${String(code)})` : err.message;
  }
  return String(err);
}

const meta: AdapterMeta = {
  id: 'clickhouse',
  capability: 'bi',
  vendor: 'ClickHouse',
  license: 'Apache-2.0',
  render: 'native',
  embedUrl: env.OFFGRID_WAREHOUSE_URL,
  description: 'Columnar analytical warehouse — tables, freshness, and read-only SQL exploration.',
};

export const clickhouseWarehouse: WarehousePort = {
  meta,

  async health() {
    try {
      // /ping is the canonical liveness endpoint (returns "Ok.\n"); doesn't need auth on the query
      // path but we still send creds so a locked-down box answers.
      const { url, user, password } = warehouseConfig();
      const res = await fetch(`${url}/ping`, {
        headers: { 'X-ClickHouse-User': user, 'X-ClickHouse-Key': password },
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async listTables() {
    try {
      const text = await runSql(buildListTablesSql());
      const now = Date.now();
      return parseClickHouseJson(text).rows.map((r) => toTableSummary(r, now));
    } catch (err) {
      console.warn('[warehouse] listTables failed, degrading to empty:', describeError(err));
      return [];
    }
  },

  async tableStats(table) {
    if (!isSafeIdentifier(table)) return null;
    try {
      const text = await runSql(buildTableStatsSql(table));
      const row = parseClickHouseJson(text).rows[0];
      if (!row) return null;
      return {
        name: String(row.name ?? table),
        database: row.database != null ? String(row.database) : undefined,
        rows: Number(row.rows ?? 0) || 0,
        bytes: Number(row.bytes ?? 0) || 0,
        engine: String(row.engine ?? ''),
        freshness: freshnessOf(row.modified as string),
      };
    } catch (err) {
      console.warn('[warehouse] tableStats failed:', describeError(err));
      return null;
    }
  },

  async sample(table, limit) {
    if (!isSafeIdentifier(table)) return null;
    try {
      const text = await runSql(buildSampleSql(table, clampLimit(limit)));
      return parseClickHouseJson(text);
    } catch (err) {
      console.warn('[warehouse] sample failed:', describeError(err));
      return null;
    }
  },

  async query(sql) {
    const guard = guardReadOnlySql(sql);
    if (!guard.ok) return { ok: false, reason: guard.reason ?? 'rejected' };
    try {
      const text = await runSql(withJsonFormat(sql));
      return { ok: true, result: parseClickHouseJson(text) };
    } catch (err) {
      return { ok: false, reason: describeError(err) };
    }
  },
};
