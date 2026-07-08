// ─── Data-plane UI model — PURE logic, zero I/O (SOLID: isolated from pages/adapters) ──────────
// Everything the data-plane management surfaces (Catalog / Query / Pipelines / health band) need
// that is a pure decision: byte/number formatting, grouping tables by database, the starter-query
// catalog against the `bfsi` schema, health-band derivation in PRODUCT language, and inferring a
// sensible default data-quality expectation set from sampled columns. No fetch, no env, no React —
// so it is exhaustively unit-testable with no mocks. Pages stay thin and delegate here.
//
// House rule enforced here: NEVER surface an OSS/engine/cloud vendor name (ClickHouse, Airbyte,
// Great Expectations, Redpanda, Debezium, AWS/Glue/Athena/DMS) to the operator. The only strings
// this module produces for the UI are Off Grid product language: Warehouse, Data movement /
// Pipelines, Query, Data quality, Streaming, Change capture.

import type { Expectation } from '@/lib/data-quality-model';
import { expectNotNull } from '@/lib/data-quality-model';

// ─── Formatting ──────────────────────────────────────────────────────────────
// Human byte size (IEC-ish, base-1024). 0 / negative / non-finite → "0 B". Pure.
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const val = n / Math.pow(1024, i);
  // Whole-number bytes show no decimal; larger units show up to one.
  const digits = i === 0 ? 0 : val >= 100 ? 0 : 1;
  return `${val.toFixed(digits)} ${units[i]}`;
}

// Indian-grouped integer (the demo tenant is BFSI/India). Non-finite → "0".
export function formatRows(rows: number | null | undefined): string {
  const n = Number(rows);
  if (!Number.isFinite(n) || n < 0) return '0';
  return Math.floor(n).toLocaleString('en-IN');
}

// ─── Table grouping (Catalog list → grouped-by-database grid) ──────────────────
// A warehouse table as the /warehouse route returns it.
export interface WarehouseTable {
  name: string; // qualified `database.table` when non-default db
  database?: string;
  rows: number;
  bytes: number;
  freshness: { label: string; ageMs: number | null; modifiedAt?: string | null };
}

export interface TableGroup {
  database: string; // 'default' when the row carried no db
  tables: WarehouseTable[];
  totalRows: number;
  totalBytes: number;
}

// The bare table name (drop the `db.` qualifier if present) — for display inside a db group.
export function bareTableName(qualified: string): string {
  const parts = String(qualified ?? '').split('.');
  return parts.length === 2 ? parts[1] : parts[0];
}

// The route segment for a table's detail page. The detail route decodes the segment and validates
// it, so the qualified `db.table` is passed through verbatim (URI-encoded by the caller).
export function tableHref(t: Pick<WarehouseTable, 'name'>): string {
  return `/data/warehouse/${encodeURIComponent(t.name)}`;
}

// Group tables by database, sorted: databases alphabetically but `bfsi` (the demo schema we must
// surface) hoisted first; tables within a group by descending row count then name.
export function groupTablesByDatabase(tables: WarehouseTable[]): TableGroup[] {
  const byDb = new Map<string, WarehouseTable[]>();
  for (const t of tables ?? []) {
    const db = t.database && t.database.trim() ? t.database : 'default';
    const arr = byDb.get(db) ?? [];
    arr.push(t);
    byDb.set(db, arr);
  }
  const groups: TableGroup[] = [...byDb.entries()].map(([database, arr]) => {
    const sorted = [...arr].sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
    return {
      database,
      tables: sorted,
      totalRows: sorted.reduce((n, t) => n + (t.rows || 0), 0),
      totalBytes: sorted.reduce((n, t) => n + (t.bytes || 0), 0),
    };
  });
  return groups.sort((a, b) => {
    if (a.database === 'bfsi') return -1;
    if (b.database === 'bfsi') return 1;
    return a.database.localeCompare(b.database);
  });
}

// Case-insensitive substring filter over table + database name. Empty query → all.
export function filterTables(tables: WarehouseTable[], query: string): WarehouseTable[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return tables ?? [];
  return (tables ?? []).filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      (t.database ?? '').toLowerCase().includes(q),
  );
}

// ─── Freshness tone (shared with the catalog's palette) ────────────────────────
export function freshnessTone(label: string, ageMs: number | null | undefined): string {
  if (label === 'unknown' || ageMs == null) return 'bg-muted text-muted-foreground';
  const day = 24 * 60 * 60 * 1000;
  if (ageMs > 30 * day) return 'bg-destructive/10 text-destructive';
  if (ageMs > day) return 'bg-amber-500/10 text-amber-600';
  return 'bg-primary/10 text-primary';
}

// ─── Starter queries (the Query console's "Athena" examples) ───────────────────
// Real, runnable read-only queries against the live `bfsi` schema (8 tables, 600k+ rows). Each is a
// single SELECT so it passes the server-side read-only guard. Titles/descriptions are operator
// language — no engine names.
export interface StarterQuery {
  id: string;
  title: string;
  description: string;
  sql: string;
}

export const STARTER_QUERIES: StarterQuery[] = [
  {
    id: 'flagged-by-channel',
    title: 'Flagged transactions by channel',
    description: 'Count of transactions marked as flagged, grouped by the channel they came through.',
    sql:
      'SELECT channel, count() AS txns, countIf(is_flagged = 1) AS flagged\n' +
      'FROM bfsi.fact_transaction\n' +
      'GROUP BY channel\n' +
      'ORDER BY flagged DESC',
  },
  {
    id: 'npa-loans-by-product',
    title: 'Non-performing loans by product',
    description: 'Loan book by product with the count and outstanding value of non-performing (NPA) loans.',
    sql:
      'SELECT p.product_name AS product,\n' +
      '       count() AS loans,\n' +
      "       countIf(l.npa_flag = 1) AS npa_loans,\n" +
      "       sum(if(l.npa_flag = 1, l.outstanding_amount, 0)) AS npa_outstanding\n" +
      'FROM bfsi.fact_loan AS l\n' +
      'LEFT JOIN bfsi.dim_product AS p ON p.product_id = l.product_id\n' +
      'GROUP BY product\n' +
      'ORDER BY npa_outstanding DESC',
  },
  {
    id: 'kyc-events-by-day',
    title: 'KYC events over the last 30 days',
    description: 'Daily volume of KYC verification events — a freshness + activity check on the pipeline.',
    sql:
      'SELECT toDate(event_time) AS day, count() AS events\n' +
      'FROM bfsi.fact_kyc_event\n' +
      'GROUP BY day\n' +
      'ORDER BY day DESC\n' +
      'LIMIT 30',
  },
  {
    id: 'accounts-by-branch',
    title: 'Accounts by branch',
    description: 'How the account base is distributed across branches, joined to the branch dimension.',
    sql:
      'SELECT b.branch_name AS branch, b.city AS city, count() AS accounts\n' +
      'FROM bfsi.fact_account AS a\n' +
      'LEFT JOIN bfsi.dim_branch AS b ON b.branch_id = a.branch_id\n' +
      'GROUP BY branch, city\n' +
      'ORDER BY accounts DESC\n' +
      'LIMIT 25',
  },
];

// ─── Query result columns (derive from either meta or the first row) ───────────
// The /warehouse/query response carries `columns:[{name,type}]`. When (defensively) absent, derive
// the column order from the first row's keys so the results table still renders.
export function deriveResultColumns(
  columns: { name: string; type?: string }[] | undefined,
  rows: Record<string, unknown>[] | undefined,
): string[] {
  if (Array.isArray(columns) && columns.length) return columns.map((c) => c.name);
  const first = Array.isArray(rows) && rows.length ? rows[0] : undefined;
  return first ? Object.keys(first) : [];
}

// Render one cell value as a string for the results/sample tables. null → "∅"; objects → JSON.
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ─── Data-quality: infer default expectations from sampled columns ─────────────
// The table-detail "run data-quality check" panel offers a sensible default suite: assert every
// column is non-null (the universal, always-supported expectation). Operators can trim the set in
// the panel. Pure: takes the column list, returns the expectation objects + a stable suite name.
export function defaultExpectationsForColumns(columns: { name: string }[] | undefined): Expectation[] {
  return (columns ?? []).filter((c) => c && c.name).map((c) => expectNotNull(c.name));
}

export function suiteNameForTable(table: string): string {
  // Suite ids are identifier-ish; keep it legible + collision-free per table.
  return `catalog.${String(table ?? 'table').replace(/[^A-Za-z0-9_.]/g, '_')}`;
}

// ─── Health band (product language) ────────────────────────────────────────────
// The four data-plane engines, in the order data moves, with the PRODUCT label shown to operators.
// `serviceId` maps to the /services/health id; the OSS/engine name is NEVER exposed.
export interface DataPlaneEngine {
  serviceId: string; // matches ServiceHealth.id
  label: string; // product language
  blurb: string; // what it does, in operator terms
}

export const DATA_PLANE_ENGINES: DataPlaneEngine[] = [
  { serviceId: 'airbyte', label: 'Pipelines', blurb: 'Moves source data into the warehouse.' },
  { serviceId: 'streaming', label: 'Streaming', blurb: 'Real-time change capture between sources and the warehouse.' },
  { serviceId: 'warehouse', label: 'Warehouse', blurb: 'The columnar store your queries and reports read.' },
  { serviceId: 'data-quality', label: 'Data quality', blurb: 'Validates data against expectations on the way in.' },
];

export interface EngineHealthView {
  serviceId: string;
  label: string;
  blurb: string;
  up: boolean;
  state: 'up' | 'down' | 'optional' | 'unknown';
  tone: string; // badge classes
  stateLabel: string; // operator-facing state text
}

// Fold a /services/health `services:[{id,status,...}]` list into the four data-plane engines' views,
// in product language. A service missing from the payload reads 'unknown' (never a scary 'down').
export function deriveDataPlaneHealth(
  services: { id: string; status: string }[] | undefined,
): EngineHealthView[] {
  const byId = new Map((services ?? []).map((s) => [s.id, s.status]));
  return DATA_PLANE_ENGINES.map((e) => {
    const status = byId.get(e.serviceId);
    const up = status === 'up' || status === 'embedded';
    let state: EngineHealthView['state'];
    if (status === 'up' || status === 'embedded') state = 'up';
    else if (status === 'optional') state = 'optional';
    else if (status === 'down') state = 'down';
    else state = 'unknown';
    const tone =
      state === 'up'
        ? 'bg-primary/10 text-primary'
        : state === 'down'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground';
    const stateLabel =
      state === 'up' ? 'Online' : state === 'down' ? 'Offline' : state === 'optional' ? 'Optional' : 'Unknown';
    return { serviceId: e.serviceId, label: e.label, blurb: e.blurb, up, state, tone, stateLabel };
  });
}
