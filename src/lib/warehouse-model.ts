// ─── Warehouse model — PURE logic, zero I/O (SOLID: isolated from the adapter) ──
// Everything here is a pure function: SQL string builders, the read-only query guard, identifier
// sanitization, ClickHouse-JSON row parsing, and freshness computation. No fetch, no env, no
// imports of any IO module — so it is exhaustively unit-testable with no mocks and no live box.
// The adapter (src/lib/adapters/warehouse.ts) does ONLY the fetch/IO and delegates every string
// decision to this file. Mirrors the tenancy-policy.ts vs tenancy.ts split in docs/ENGINEERING.md.

// ─── Identifier sanitization ────────────────────────────────────────────────
// A ClickHouse table/db identifier interpolated into a statement (bound params can't parameterize
// an identifier). We allow only [A-Za-z0-9_.] — letters, digits, underscore, and a dot for the
// optional `database.table` qualifier — and reject everything else (spaces, quotes, backticks,
// semicolons, parens, comment markers). That closes the interpolation injection surface: there is
// no character left that could break out of the identifier position.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

export function isSafeIdentifier(name: string): boolean {
  return typeof name === 'string' && SAFE_IDENTIFIER.test(name);
}

// Return the identifier verbatim if safe, else null. Callers turn null into a rejection/empty result
// — never interpolate an unvalidated name.
export function safeIdentifier(name: string): string | null {
  return isSafeIdentifier(name) ? name : null;
}

// Quote an identifier for a ClickHouse statement. Only called AFTER isSafeIdentifier, so the input
// contains no backticks to escape; we still split a `db.table` on the dot and backtick each part so
// the qualifier survives. Throws on an unsafe identifier — a programming error, not a runtime path
// (adapters guard with safeIdentifier first and return null).
export function quoteIdentifier(name: string): string {
  if (!isSafeIdentifier(name)) throw new Error(`unsafe identifier: ${name}`);
  return name
    .split('.')
    .map((part) => `\`${part}\``)
    .join('.');
}

// Split a possibly-qualified identifier into { database, table }. `foo` → {table:'foo'};
// `db.foo` → {database:'db', table:'foo'}. Returns null when unsafe.
export function splitTable(name: string): { database?: string; table: string } | null {
  if (!isSafeIdentifier(name)) return null;
  const parts = name.split('.');
  return parts.length === 2 ? { database: parts[0], table: parts[1] } : { table: parts[0] };
}

// ─── Limit clamping ───────────────────────────────────────────────────────────
export const DEFAULT_SAMPLE_LIMIT = 50;
export const MAX_SAMPLE_LIMIT = 1000;

export function clampLimit(limit: number | undefined): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) return DEFAULT_SAMPLE_LIMIT;
  return Math.max(1, Math.min(Math.floor(n), MAX_SAMPLE_LIMIT));
}

// ─── SQL builders (return statements + the FORMAT for the HTTP interface) ──────
// ClickHouse's HTTP interface returns JSON when the query ends `FORMAT JSON`. We always request
// that format so the adapter can parse a single shape. These builders never accept raw user SQL —
// only sanitized identifiers and clamped limits — so their output is always well-formed and safe.

// List user tables across databases, excluding ClickHouse's own system schemas. Carries row count,
// on-disk bytes, and the latest part-modification time so the list view has freshness without a
// second round-trip.
export function buildListTablesSql(): string {
  return (
    'SELECT database, name, total_rows AS rows, total_bytes AS bytes, ' +
    'toString(metadata_modification_time) AS modified ' +
    'FROM system.tables ' +
    "WHERE database NOT IN ('system','INFORMATION_SCHEMA','information_schema') " +
    'ORDER BY database, name FORMAT JSON'
  );
}

// Row count + total on-disk bytes + latest data-part modification time for ONE table. Rows/bytes
// come from system.tables (total_rows/total_bytes — accurate for BOTH MergeTree and part-less
// engines like Memory, where system.parts is empty). The freshest data-part modification time is
// pulled from system.parts via a correlated scalar subquery so a Memory table (no parts) simply
// yields NULL → falls back to the table's metadata_modification_time.
export function buildTableStatsSql(table: string): string {
  const id = splitTable(table);
  if (!id) throw new Error(`unsafe identifier: ${table}`);
  const dbLit = id.database ? sqlString(id.database) : 'currentDatabase()';
  const nameLit = sqlString(id.table);
  return (
    'SELECT ' +
    't.name AS name, ' +
    't.database AS database, ' +
    'toUInt64(coalesce(t.total_rows, 0)) AS rows, ' +
    'toUInt64(coalesce(t.total_bytes, 0)) AS bytes, ' +
    'toString(coalesce(( ' +
    'SELECT max(modification_time) FROM system.parts ' +
    `WHERE active AND database = ${dbLit} AND table = ${nameLit} ` +
    '), t.metadata_modification_time)) AS modified, ' +
    't.engine AS engine ' +
    'FROM system.tables t ' +
    `WHERE t.database = ${dbLit} AND t.name = ${nameLit} ` +
    'LIMIT 1 FORMAT JSON'
  );
}

// SELECT * FROM table LIMIT n. The limit is clamped; the identifier is validated + backtick-quoted.
export function buildSampleSql(table: string, limit?: number): string {
  const quoted = quoteIdentifier(table); // throws on unsafe — adapter guards first
  return `SELECT * FROM ${quoted} LIMIT ${clampLimit(limit)} FORMAT JSON`;
}

// Single-quote-escape a string literal for ClickHouse (double the quote + backslash). Used only for
// our own db/table names (already identifier-safe), never for arbitrary input, but correct regardless.
export function sqlString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ─── Read-only query guard (pure) ──────────────────────────────────────────────
// The user-facing /query endpoint runs operator-typed SQL. It MUST be read-only. This guard is the
// single source of truth for "is this SQL safe to run". Rules:
//   - exactly ONE statement (no `;`-stacked statements; a single trailing `;` is tolerated)
//   - the leading keyword is SELECT / SHOW / DESCRIBE / DESC / EXPLAIN / WITH  (read verbs only)
//   - no write/DDL keyword anywhere as a token (INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/
//     RENAME/ATTACH/DETACH/OPTIMIZE/GRANT/REVOKE/SET/SYSTEM/KILL/INTO/FORMAT-writes…)
//   - no SQL comments (`--`, `/* */`, `#`) which can hide a second statement or smuggle a verb
// A single SELECT with a WITH CTE is allowed; a WITH that fronts an INSERT is caught by the
// forbidden-token scan. Returns { ok, reason } — the route surfaces `reason` as a 400.

const READ_LEADERS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']);

// Write / DDL / admin verbs that must never appear as a standalone token in a read query.
const FORBIDDEN_TOKENS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'RENAME',
  'ATTACH', 'DETACH', 'OPTIMIZE', 'GRANT', 'REVOKE', 'SET', 'SYSTEM', 'KILL',
  'INTO', 'REPLACE', 'MERGE', 'MOVE', 'MODIFY', 'EXCHANGE', 'CALL', 'USE',
]);

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

export function guardReadOnlySql(rawSql: string): GuardResult {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    return { ok: false, reason: 'empty query' };
  }
  const sql = rawSql.trim();

  // Comments can hide a second statement or a smuggled verb — reject outright.
  if (/--|\/\*|\*\/|#/.test(sql)) {
    return { ok: false, reason: 'comments are not allowed' };
  }

  // Statement stacking: strip a single trailing semicolon, then reject any remaining semicolon.
  const withoutTrailing = sql.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return { ok: false, reason: 'multiple statements are not allowed' };
  }

  // Leading keyword must be a read verb.
  const leaderMatch = withoutTrailing.match(/^([A-Za-z]+)/);
  const leader = (leaderMatch?.[1] ?? '').toUpperCase();
  if (!READ_LEADERS.has(leader)) {
    return { ok: false, reason: `only read queries are allowed (got "${leader || '?'}")` };
  }

  // Scan every word-boundary token for a forbidden verb. Word boundaries mean a column named
  // e.g. `created_at` won't trip CREATE, but a bare `CREATE`/`INSERT` token will.
  const tokens = withoutTrailing.toUpperCase().match(/[A-Z_]+/g) ?? [];
  for (const tok of tokens) {
    if (FORBIDDEN_TOKENS.has(tok)) {
      return { ok: false, reason: `forbidden keyword: ${tok}` };
    }
  }

  return { ok: true };
}

// Ensure a guarded read query carries `FORMAT JSON` so the HTTP interface returns parseable JSON.
// If the operator already put a FORMAT clause we leave it (they may want TSV/etc. — still read-only);
// otherwise we append FORMAT JSON. Pure string transform.
export function withJsonFormat(sql: string): string {
  const s = sql.trim().replace(/;\s*$/, '');
  return /\bFORMAT\s+[A-Za-z]+\s*$/i.test(s) ? s : `${s} FORMAT JSON`;
}

// ─── ClickHouse JSON parsing ────────────────────────────────────────────────
// The HTTP interface with FORMAT JSON returns { meta:[{name,type}], data:[{...}], rows, statistics }.
// Parse defensively: a non-JSON body (an error page, a TSV response) yields an empty result rather
// than throwing, so the adapter degrades gracefully.
export interface ClickHouseColumn {
  name: string;
  type: string;
}

export interface ParsedClickHouse {
  columns: ClickHouseColumn[];
  rows: Record<string, unknown>[];
  count: number;
}

export function parseClickHouseJson(text: string): ParsedClickHouse {
  const empty: ParsedClickHouse = { columns: [], rows: [], count: 0 };
  if (!text || !text.trim()) return empty;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return empty;
  }
  if (!obj || typeof obj !== 'object') return empty;
  const o = obj as {
    meta?: unknown;
    data?: unknown;
    rows?: unknown;
  };
  const columns: ClickHouseColumn[] = Array.isArray(o.meta)
    ? (o.meta as Record<string, unknown>[]).map((m) => ({
        name: String(m.name ?? ''),
        type: String(m.type ?? ''),
      }))
    : [];
  const rows: Record<string, unknown>[] = Array.isArray(o.data)
    ? (o.data as Record<string, unknown>[])
    : [];
  const count = typeof o.rows === 'number' ? o.rows : rows.length;
  return { columns, rows, count };
}

// ─── Freshness ─────────────────────────────────────────────────────────────
// Turn a table's last-modified timestamp into an age + a human label. `modifiedAt` is the string
// ClickHouse returns (e.g. "2026-07-08 10:12:33") or a Date/number; `now` is injected so this stays
// pure and testable. An unparseable/zero timestamp yields { ageMs: null, label: 'unknown' }.
export interface Freshness {
  ageMs: number | null;
  label: string;
  modifiedAt: string | null;
}

export function freshnessOf(
  modifiedAt: string | number | Date | null | undefined,
  now: number = Date.now(),
): Freshness {
  if (modifiedAt == null || modifiedAt === '' || modifiedAt === '0000-00-00 00:00:00') {
    return { ageMs: null, label: 'unknown', modifiedAt: null };
  }
  let ts: number;
  let iso: string;
  if (modifiedAt instanceof Date) {
    ts = modifiedAt.getTime();
    iso = modifiedAt.toISOString();
  } else if (typeof modifiedAt === 'number') {
    ts = modifiedAt;
    iso = new Date(modifiedAt).toISOString();
  } else {
    // ClickHouse renders datetimes as "YYYY-MM-DD HH:MM:SS" (space, no zone). Treat as UTC.
    const norm = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(modifiedAt)
      ? modifiedAt.replace(' ', 'T') + 'Z'
      : modifiedAt;
    ts = Date.parse(norm);
    iso = Number.isNaN(ts) ? modifiedAt : new Date(ts).toISOString();
  }
  if (Number.isNaN(ts) || ts <= 0) {
    return { ageMs: null, label: 'unknown', modifiedAt: typeof modifiedAt === 'string' ? modifiedAt : null };
  }
  const ageMs = Math.max(0, now - ts);
  return { ageMs, label: humanizeAge(ageMs), modifiedAt: iso };
}

function humanizeAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// ─── Normalized table summary (list view shape) ────────────────────────────
// Fold a parsed list-tables row into the API shape { name, rows, bytes, freshness }. `name` is the
// qualified `database.table` when the row carries a non-default database.
export interface TableSummary {
  name: string;
  database?: string;
  rows: number;
  bytes: number;
  freshness: Freshness;
}

export function toTableSummary(row: Record<string, unknown>, now: number = Date.now()): TableSummary {
  const database = row.database != null ? String(row.database) : undefined;
  const table = String(row.name ?? '');
  const qualified = database && database !== 'default' ? `${database}.${table}` : table;
  return {
    name: qualified,
    database,
    rows: Number(row.rows ?? 0) || 0,
    bytes: Number(row.bytes ?? 0) || 0,
    freshness: freshnessOf(row.modified as string, now),
  };
}
