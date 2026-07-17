// ─── ETL job spec — PURE logic, zero I/O (SOLID: isolated from the run engine) ──
// An ETL job is the AUTHORED spec an operator writes in the Data tab: pull from a source connector
// (postgres/mysql/mssql/rest) → optionally rename/select columns → apply per-column redaction on the
// movement path → land in a ClickHouse warehouse table on a schedule. This module is the model +
// validation + the pure mappers the run engine and the Airbyte compiler consume. NO fetch, NO env,
// NO db — every function here is unit-testable with no mocks (mirrors warehouse-model.ts vs
// warehouse.ts, etl-model.ts vs airbyte.ts). The I/O run path lives in etl-jobs-store.ts + the route.

import type { RedactionAction, RedactionPolicy, ColumnRule } from './data-redaction';
import { normalizeJobStatus, type EtlJobStatus } from './etl-model';

// ─── The authored spec ─────────────────────────────────────────────────────────
// How a job is triggered: 'manual' = only run-now; 'schedule' = run on the cron too.
export type EtlTriggerMode = 'manual' | 'schedule';
export type ManagedEtlBlueprint = 'bfsi-delinquency-snapshot';

// One column-mapping row: read `source` from the source, write it to `dest` in the warehouse, and
// apply `action` to its values on the way (reusing the data-redaction vocabulary). `dest` defaults
// to `source` when blank (a pass-through rename is optional).
export interface ColumnMapping {
  source: string;
  dest?: string;
  action?: RedactionAction; // default 'keep'
  keepLast?: number; // for 'mask'
}

// The full job spec the operator authors and we persist. `id`/`orgId`/timestamps are stamped by the
// store; the authoring form supplies everything else.
export interface EtlJobSpec {
  id: string;
  orgId: string;
  name: string;
  // Source: an existing console connector + the resource (table / REST collection) on it.
  sourceConnectorId: string;
  sourceResource: string;
  // Destination: the ClickHouse warehouse database + table the rows land in.
  destDatabase: string;
  destTable: string;
  // Movement governance: the per-column mapping/transform/redaction rules.
  mappings: ColumnMapping[];
  // Trigger + schedule.
  trigger: EtlTriggerMode;
  cron?: string; // required when trigger === 'schedule'
  // Row cap per run (safety valve; clamped).
  rowLimit?: number;
  createdAt?: string;
  updatedAt?: string;
  lastRunStatus?: EtlJobStatus;
  lastRunAt?: string;
  // The visual DAG the builder authored. When present it's the source of truth the orchestration
  // compiler consumes; the flat source/dest/mappings fields above are kept in sync (derived from it)
  // so the legacy direct-copy engine + list rendering keep working.
  dag?: EtlDagSpec;
  // Server-provisioned, product-owned workflow. Operators still manage it through the same ETL
  // CRUD/detail surface; the key selects a reviewed compiler rather than accepting arbitrary SQL.
  managedBlueprint?: ManagedEtlBlueprint;
}

// What the authoring form submits (no server-stamped fields).
export type EtlJobDraft = Omit<
  EtlJobSpec,
  'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'lastRunStatus' | 'lastRunAt' | 'managedBlueprint'
>;

// ─── Identifier + cron validation (pure) ────────────────────────────────────────
// Warehouse db/table + dest column names are interpolated into ClickHouse DDL/DML, so they must be
// safe identifiers (same class as warehouse-model.isSafeIdentifier — letters/digits/underscore, no
// dot: db and table are separate fields here). Source resource is validated by connector-exec's own
// guard at query time; here we only require it non-empty.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeIdent(name: unknown): name is string {
  return typeof name === 'string' && SAFE_IDENT.test(name);
}

// A pragmatic 5-field cron validator (min hour dom mon dow). Each field is `*`, a number, a
// step (*/n), a range (a-b), or a comma list of those. Not a full parser — enough to reject
// obvious garbage before it reaches the scheduler, without pulling a dependency.
const CRON_FIELD = /^(\*|\*\/\d+|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)$/;

export function isValidCron(expr: unknown): expr is string {
  if (typeof expr !== 'string') return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => CRON_FIELD.test(p));
}

export const DEFAULT_ROW_LIMIT = 1000;
export const MAX_ROW_LIMIT = 100_000;

export function clampRowLimit(limit: number | undefined): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) return DEFAULT_ROW_LIMIT;
  return Math.max(1, Math.min(Math.floor(n), MAX_ROW_LIMIT));
}

// ─── Draft validation ───────────────────────────────────────────────────────────
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// Validate an authored draft before it's persisted or run. Collects ALL errors (not fail-fast) so
// the form can show everything at once. Pure — no I/O, so the same rule runs client- and server-side.
export function validateJobDraft(draft: Partial<EtlJobDraft> | null | undefined): ValidationResult {
  const errors: string[] = [];
  if (!draft || typeof draft !== 'object') {
    return { ok: false, errors: ['A job spec is required.'] };
  }
  if (!draft.name || !String(draft.name).trim()) {
    errors.push('A job name is required.');
  }
  if (!draft.sourceConnectorId || !String(draft.sourceConnectorId).trim()) {
    errors.push('A source connector is required.');
  }
  if (!draft.sourceResource || !String(draft.sourceResource).trim()) {
    errors.push('A source table/resource is required.');
  }
  if (!isSafeIdent(draft.destDatabase)) {
    errors.push('Destination database must be a valid identifier (letters, digits, underscore).');
  }
  if (!isSafeIdent(draft.destTable)) {
    errors.push('Destination table must be a valid identifier (letters, digits, underscore).');
  }
  const mappings = Array.isArray(draft.mappings) ? draft.mappings : [];
  for (const [i, m] of mappings.entries()) {
    if (!m?.source || !String(m.source).trim()) {
      errors.push(`Mapping ${i + 1}: a source column is required.`);
      continue;
    }
    const dest = destColumn(m);
    if (!isSafeIdent(dest)) {
      errors.push(`Mapping ${i + 1}: destination column "${dest}" must be a valid identifier.`);
    }
  }
  if (draft.trigger === 'schedule' && !isValidCron(draft.cron)) {
    errors.push('A valid 5-field cron expression is required for a scheduled job.');
  }
  return { ok: errors.length === 0, errors };
}

// ─── Pure derivations ─────────────────────────────────────────────────────────
// The warehouse column a mapping writes to: explicit `dest`, else the source name.
export function destColumn(m: ColumnMapping): string {
  const d = (m.dest ?? '').trim();
  return d || (m.source ?? '').trim();
}

// The redaction policy (data-redaction.ts vocabulary) derived from the mappings — one ColumnRule per
// mapping that has a non-'keep' action, keyed by the SOURCE column (redaction runs on source rows,
// BEFORE the rename to dest). Columns with no action / 'keep' carry no rule (pass through).
export function redactionPolicyFromMappings(mappings: ColumnMapping[]): RedactionPolicy {
  const rules: ColumnRule[] = [];
  for (const m of mappings) {
    const action: RedactionAction = m.action ?? 'keep';
    if (action === 'keep') continue;
    const rule: ColumnRule = { column: (m.source ?? '').trim(), action };
    if (action === 'mask' && typeof m.keepLast === 'number') rule.keepLast = m.keepLast;
    rules.push(rule);
  }
  return rules;
}

// Project a REDACTED source row onto the destination shape: for each mapping, read the (already
// redacted) value at `source` and write it under `destColumn`. When there are NO mappings the row
// passes through whole (full-table copy) — the common "just move it" case. Pure; unknown source
// columns yield null so the warehouse column is present and typed consistently.
export function projectRow(
  row: Record<string, unknown>,
  mappings: ColumnMapping[],
): Record<string, unknown> {
  if (!mappings.length) return { ...row };
  const out: Record<string, unknown> = {};
  for (const m of mappings) {
    const src = (m.source ?? '').trim();
    out[destColumn(m)] = src in row ? row[src] : null;
  }
  return out;
}

// The destination column list (order-stable) for a spec: the mapping dest columns, or — when there
// are no mappings — the union of keys across the sampled rows (full-table copy). Drives CREATE TABLE.
export function destColumns(
  mappings: ColumnMapping[],
  sampleRows: Record<string, unknown>[],
): string[] {
  if (mappings.length) return mappings.map(destColumn);
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const r of sampleRows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

// ─── Compile to an Airbyte connection config (pure mapper) ──────────────────────
// The Airbyte path: given the job spec + the resolved Airbyte source/destination ids, produce the
// connections/create body — the shape the Airbyte config API expects (syncCatalog is minimal: one
// stream for the source resource, full-refresh|overwrite into the dest table). Kept pure so it's
// unit-tested without a live box; the adapter POSTs it when Airbyte connection-creation is wired.
// When Airbyte can't create connections we fall back to the governed direct-copy (etl-jobs-store.runJob).
export interface AirbyteConnectionConfig {
  name: string;
  sourceId: string;
  destinationId: string;
  namespaceDefinition: 'destination';
  status: 'active' | 'inactive';
  scheduleType: 'manual' | 'cron';
  scheduleData?: { cron: { cronExpression: string; cronTimeZone: string } };
  syncCatalog: {
    streams: {
      stream: { name: string; namespace?: string };
      config: {
        selected: true;
        syncMode: 'full_refresh';
        destinationSyncMode: 'overwrite';
        aliasName: string;
      };
    }[];
  };
}

export function compileToAirbyteConfig(
  spec: EtlJobSpec,
  sourceId: string,
  destinationId: string,
): AirbyteConnectionConfig {
  const cron = spec.trigger === 'schedule' && spec.cron ? spec.cron : undefined;
  const config: AirbyteConnectionConfig = {
    name: spec.name,
    sourceId,
    destinationId,
    namespaceDefinition: 'destination',
    status: spec.trigger === 'schedule' ? 'active' : 'inactive',
    scheduleType: cron ? 'cron' : 'manual',
    syncCatalog: {
      streams: [
        {
          stream: { name: spec.sourceResource },
          config: {
            selected: true,
            syncMode: 'full_refresh',
            destinationSyncMode: 'overwrite',
            aliasName: spec.destTable,
          },
        },
      ],
    },
  };
  if (cron) {
    config.scheduleData = { cron: { cronExpression: cron, cronTimeZone: 'UTC' } };
  }
  return config;
}

// ─── ClickHouse landing SQL (pure builders) ─────────────────────────────────────
// The governed direct-copy path lands rows in ClickHouse. These builders produce the DDL/DML the
// warehouse HTTP interface runs; they NEVER accept raw SQL — only identifier-validated db/table/
// column names and JSON-encoded row values — so their output is always well-formed. The I/O
// (POSTing them) lives in the store; keeping the strings here makes them unit-testable with no box.

// CREATE DATABASE IF NOT EXISTS <db>. Identifier must be pre-validated (isSafeIdent).
export function buildCreateDatabaseSql(database: string): string {
  if (!isSafeIdent(database)) throw new Error(`unsafe database identifier: ${database}`);
  return `CREATE DATABASE IF NOT EXISTS \`${database}\``;
}

// CREATE TABLE IF NOT EXISTS <db>.<table> — every column a Nullable(String) so any source shape
// lands without a type-inference round-trip (the warehouse is the analytics store; downstream views
// cast). A MergeTree needs an ORDER BY; we use `tuple()` (no sorting key) so no column is required.
// `_ingested_at` gives every landed row a load timestamp for freshness/lineage.
export function buildCreateTableSql(database: string, table: string, columns: string[]): string {
  if (!isSafeIdent(database)) throw new Error(`unsafe database identifier: ${database}`);
  if (!isSafeIdent(table)) throw new Error(`unsafe table identifier: ${table}`);
  const cols = columns.filter((c) => isSafeIdent(c));
  const colDefs = cols.map((c) => `\`${c}\` Nullable(String)`);
  colDefs.push('`_ingested_at` DateTime DEFAULT now()');
  return (
    `CREATE TABLE IF NOT EXISTS \`${database}\`.\`${table}\` ` +
    `(${colDefs.join(', ')}) ENGINE = MergeTree ORDER BY tuple()`
  );
}

// TRUNCATE the target before a full-refresh load so a re-run overwrites rather than appends
// (matches the Airbyte full_refresh|overwrite semantics the compiler emits).
export function buildTruncateSql(database: string, table: string): string {
  if (!isSafeIdent(database)) throw new Error(`unsafe database identifier: ${database}`);
  if (!isSafeIdent(table)) throw new Error(`unsafe table identifier: ${table}`);
  return `TRUNCATE TABLE IF EXISTS \`${database}\`.\`${table}\``;
}

// INSERT ... FORMAT JSONEachRow with the batch serialized one JSON object per line. Values are
// stringified (the table columns are Nullable(String)); null stays null. Columns not in `columns`
// are dropped; missing values become null. Returns null for an empty batch (nothing to POST).
export function buildInsertSql(
  database: string,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): string | null {
  if (!isSafeIdent(database)) throw new Error(`unsafe database identifier: ${database}`);
  if (!isSafeIdent(table)) throw new Error(`unsafe table identifier: ${table}`);
  const cols = columns.filter((c) => isSafeIdent(c));
  if (!cols.length || !rows.length) return null;
  const colList = cols.map((c) => `\`${c}\``).join(', ');
  const lines = rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (const c of cols) {
      const v = row[c];
      if (v == null) obj[c] = null;
      else if (typeof v === 'string') obj[c] = v;
      else obj[c] = JSON.stringify(v);
    }
    return JSON.stringify(obj);
  });
  return `INSERT INTO \`${database}\`.\`${table}\` (${colList}) FORMAT JSONEachRow\n${lines.join('\n')}`;
}

// COUNT(*) for the landed table — used to verify rows actually landed (honest rowsWritten).
export function buildCountSql(database: string, table: string): string {
  if (!isSafeIdent(database)) throw new Error(`unsafe database identifier: ${database}`);
  if (!isSafeIdent(table)) throw new Error(`unsafe table identifier: ${table}`);
  return `SELECT count() AS n FROM \`${database}\`.\`${table}\` FORMAT JSON`;
}

// ─── Run status normalization (pure) ────────────────────────────────────────────
// A run's outcome, folded onto the console job-status vocabulary. A governed direct-copy run reports
// its own outcome ('ok' → succeeded, 'error' → failed, etc.); an Airbyte run reports an Airbyte
// status. Both funnel through here so the UI never has to know which path ran. Reuses
// etl-model.normalizeJobStatus for the Airbyte spellings and maps the copy-engine's own words.
export function normalizeRunStatus(raw: unknown): EtlJobStatus {
  const s = String(raw ?? '').toLowerCase().trim();
  switch (s) {
    case 'ok':
    case 'done':
      return 'succeeded';
    case 'error':
      return 'failed';
    default:
      return normalizeJobStatus(raw);
  }
}

// A single run record's compact view (what the detail page's run history renders).
export interface EtlRunView {
  runId: string;
  jobId: string;
  status: EtlJobStatus;
  path: 'kestra' | 'airbyte' | 'direct-copy';
  rowsRead: number;
  rowsWritten: number;
  redacted: number;
  message?: string;
  startedAt: string;
  finishedAt?: string;
  /** The orchestrator execution id when the run went through the orchestration engine. */
  executionId?: string;
}

// ─── The visual ETL DAG — the richer AUTHORING model (source → transforms → destination) ────────
// This is what the visual builder edits and what compiles to an orchestration flow. It is a superset
// of the flat EtlJobSpec above (which stays the persisted DB record): the DAG's source maps to
// sourceConnectorId/sourceResource, its destination to destDatabase/destTable, and its transform
// chain is the richer expression of what the flat `mappings` captured. PURE + zero-IO: the compiler
// and the UI both consume it; the store persists it as JSON on the job row. NO fetch/env/db here.

// The transforms the operator can chain. Each is a pure, declarative step over the row stream:
//  · filter   — keep rows where a column compares to a value (drop the rest)
//  · select   — keep only the named columns (project)
//  · rename   — rename a column
//  · cast      — coerce a column to a type (string/int/float/bool/date)
//  · derive    — add a column from an expression (the lambda-equivalent; runs in a script task)
//  · redact    — apply a redaction action to a column ON THE MOVEMENT PATH (governance)
//  · join      — join a second source resource on a key (enrichment)
//  · aggregate — group by columns + aggregate a measure (count/sum/avg/min/max)
//  · dedupe    — drop duplicate rows by key columns
//  · limit     — cap the number of rows
export type EtlTransformKind =
  | 'filter'
  | 'select'
  | 'rename'
  | 'cast'
  | 'derive'
  | 'redact'
  | 'join'
  | 'aggregate'
  | 'dedupe'
  | 'limit';

export type EtlNodeKind = 'source' | EtlTransformKind | 'destination';

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
export type CastType = 'string' | 'int' | 'float' | 'bool' | 'date';
export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

// The per-node configuration — a discriminated union keyed by node `kind`. Only the fields relevant
// to a node's kind are set; the compiler and validator switch on `kind`.
export interface EtlNodeConfig {
  // source
  connectorId?: string;
  resource?: string;
  // destination
  database?: string;
  table?: string;
  // filter
  column?: string;
  op?: FilterOp;
  value?: string;
  // select / dedupe (columns), aggregate group-by
  columns?: string[];
  // rename
  from?: string;
  to?: string;
  // cast
  castType?: CastType;
  // derive
  target?: string;
  expression?: string; // a safe row expression (e.g. "amount * 1.18"); runs in a script task
  // redact
  action?: RedactionAction;
  keepLast?: number;
  // join
  joinConnectorId?: string;
  joinResource?: string;
  leftKey?: string;
  rightKey?: string;
  // aggregate
  groupBy?: string[];
  aggFn?: AggFn;
  aggColumn?: string;
  aggAlias?: string;
  // limit
  limit?: number;
}

// A node in the DAG. `id` is stable within the spec; `position` is UI-only (canvas coords).
export interface EtlNode {
  id: string;
  kind: EtlNodeKind;
  label?: string;
  config: EtlNodeConfig;
  position?: { x: number; y: number };
}

// A directed edge source→…→destination. The DAG is a linear-or-branching pipeline; the compiler
// walks it topologically.
export interface EtlEdge {
  from: string;
  to: string;
}

// The full visual DAG spec — source node(s) → transform nodes → destination node(s), plus trigger.
export interface EtlDagSpec {
  nodes: EtlNode[];
  edges: EtlEdge[];
  trigger: EtlTriggerMode;
  cron?: string;
  rowLimit?: number;
}

// ─── DAG helpers (pure) ─────────────────────────────────────────────────────────────────────────
export function sourceNodes(spec: EtlDagSpec): EtlNode[] {
  return spec.nodes.filter((n) => n.kind === 'source');
}
export function destinationNodes(spec: EtlDagSpec): EtlNode[] {
  return spec.nodes.filter((n) => n.kind === 'destination');
}
export function transformNodes(spec: EtlDagSpec): EtlNode[] {
  return spec.nodes.filter((n) => n.kind !== 'source' && n.kind !== 'destination');
}

// Topological order of the nodes following edges from the source(s). Returns null when the graph has
// a cycle or a node is unreachable/dangling (an authoring error the validator reports).
export function topoOrder(spec: EtlDagSpec): EtlNode[] | null {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>(spec.nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const n of spec.nodes) out.set(n.id, []);
  for (const e of spec.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) return null; // dangling edge
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const queue = spec.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: EtlNode[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(byId.get(id)!);
    for (const nxt of out.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1);
      if ((indeg.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  return order.length === spec.nodes.length ? order : null; // cycle → fewer than all
}

// A safe expression guard for `derive`: allow column names, numbers, strings, arithmetic and simple
// comparisons only. Rejects anything that could be code (function calls, brackets, semicolons) so a
// derived-column expression can be compiled into a script task without an injection surface.
const SAFE_EXPR = /^[A-Za-z0-9_+\-*/%.,()'"\s<>=!&|]*$/;
const UNSAFE_EXPR_TOKEN = /(;|=>|`|\$\{|\bimport\b|\brequire\b|\bprocess\b|\beval\b|\bFunction\b)/;
export function isSafeExpression(expr: unknown): expr is string {
  return (
    typeof expr === 'string' &&
    expr.trim().length > 0 &&
    SAFE_EXPR.test(expr) &&
    !UNSAFE_EXPR_TOKEN.test(expr)
  );
}

// Validate a DAG spec (pure — collects ALL errors). Checks: exactly-reachable graph, a source + a
// destination, safe identifiers on destination db/table, per-node required fields, safe derive
// expressions, and a valid cron when scheduled.
export function validateDagSpec(spec: Partial<EtlDagSpec> | null | undefined): ValidationResult {
  const errors: string[] = [];
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.nodes)) {
    return { ok: false, errors: ['A DAG spec with nodes is required.'] };
  }
  const nodes = spec.nodes;
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const full: EtlDagSpec = {
    nodes,
    edges,
    trigger: spec.trigger === 'schedule' ? 'schedule' : 'manual',
    cron: spec.cron,
    rowLimit: spec.rowLimit,
  };

  const srcs = sourceNodes(full);
  const dests = destinationNodes(full);
  if (srcs.length === 0) errors.push('The job needs a source node.');
  if (dests.length === 0) errors.push('The job needs a destination node.');

  for (const s of srcs) {
    if (!s.config.connectorId) errors.push(`Source "${s.label ?? s.id}": pick a source connector.`);
    if (!s.config.resource || !String(s.config.resource).trim())
      errors.push(`Source "${s.label ?? s.id}": a source table/resource is required.`);
  }
  for (const d of dests) {
    if (!isSafeIdent(d.config.database))
      errors.push(`Destination "${d.label ?? d.id}": database must be a valid identifier.`);
    if (!isSafeIdent(d.config.table))
      errors.push(`Destination "${d.label ?? d.id}": table must be a valid identifier.`);
  }

  for (const n of transformNodes(full)) {
    const c = n.config;
    const who = n.label ?? n.kind;
    switch (n.kind) {
      case 'filter':
        if (!c.column) errors.push(`Filter "${who}": a column is required.`);
        if (!c.op) errors.push(`Filter "${who}": an operator is required.`);
        break;
      case 'select':
      case 'dedupe':
        if (!Array.isArray(c.columns) || c.columns.length === 0)
          errors.push(`${n.kind} "${who}": at least one column is required.`);
        break;
      case 'rename':
        if (!c.from || !isSafeIdent(c.to))
          errors.push(`Rename "${who}": a source column and a valid target name are required.`);
        break;
      case 'cast':
        if (!c.column || !c.castType) errors.push(`Cast "${who}": a column and a type are required.`);
        break;
      case 'derive':
        if (!isSafeIdent(c.target))
          errors.push(`Derive "${who}": a valid target column name is required.`);
        if (!isSafeExpression(c.expression))
          errors.push(`Derive "${who}": the expression is empty or contains unsafe tokens.`);
        break;
      case 'redact':
        if (!c.column) errors.push(`Redact "${who}": a column is required.`);
        if (!c.action || c.action === 'keep')
          errors.push(`Redact "${who}": choose a redaction action (mask/hash/tokenize/drop/detect).`);
        break;
      case 'join':
        if (!c.joinConnectorId || !c.joinResource || !c.leftKey || !c.rightKey)
          errors.push(`Join "${who}": a second source, its resource, and both keys are required.`);
        break;
      case 'aggregate':
        if (!Array.isArray(c.groupBy) || c.groupBy.length === 0)
          errors.push(`Aggregate "${who}": at least one group-by column is required.`);
        if (!c.aggFn) errors.push(`Aggregate "${who}": an aggregate function is required.`);
        if (c.aggFn !== 'count' && !c.aggColumn)
          errors.push(`Aggregate "${who}": ${c.aggFn} needs a measure column.`);
        break;
      case 'limit':
        if (!Number.isFinite(Number(c.limit)) || Number(c.limit) <= 0)
          errors.push(`Limit "${who}": a positive row count is required.`);
        break;
    }
  }

  if (nodes.length > 0 && topoOrder(full) === null)
    errors.push('The graph has a cycle or a disconnected/dangling node — fix the connections.');

  if (full.trigger === 'schedule' && !isValidCron(full.cron))
    errors.push('A valid 5-field cron expression is required for a scheduled job.');

  return { ok: errors.length === 0, errors };
}

// Derive the flat job fields (the persisted DB columns + the legacy direct-copy engine's inputs)
// from a DAG. Takes the first source + first destination; folds each `redact`/`rename`/`select`
// transform into the flat `mappings` vocabulary so the flat model stays a faithful (if lossy)
// projection of the DAG. Pure. The DAG remains the source of truth for the orchestration compiler.
export function flattenDagToJobFields(dag: EtlDagSpec): EtlJobDraft & { dag: EtlDagSpec } {
  const src = sourceNodes(dag)[0];
  const dest = destinationNodes(dag)[0];
  const mappings: ColumnMapping[] = [];
  const renames = new Map<string, string>();
  for (const n of transformNodes(dag)) {
    if (n.kind === 'rename' && n.config.from && n.config.to) {
      renames.set(n.config.from, n.config.to);
    }
  }
  for (const n of transformNodes(dag)) {
    if (n.kind === 'redact' && n.config.column && n.config.action) {
      mappings.push({
        source: n.config.column,
        dest: renames.get(n.config.column),
        action: n.config.action,
        keepLast: n.config.keepLast,
      });
    }
  }
  // Any renames not already covered by a redact mapping → pass-through rename rows.
  for (const [from, to] of renames) {
    if (!mappings.some((m) => m.source === from)) mappings.push({ source: from, dest: to, action: 'keep' });
  }
  return {
    name: '', // caller supplies the job name
    sourceConnectorId: src?.config.connectorId ?? '',
    sourceResource: src?.config.resource ?? '',
    destDatabase: dest?.config.database ?? '',
    destTable: dest?.config.table ?? '',
    mappings,
    trigger: dag.trigger,
    cron: dag.cron,
    rowLimit: dag.rowLimit,
    dag,
  };
}

// Build a minimal default DAG (source → destination) for a freshly-created job, so the builder opens
// on a valid two-node canvas the operator extends. Pure.
export function defaultDag(): EtlDagSpec {
  return {
    nodes: [
      { id: 'source', kind: 'source', label: 'Source', config: {}, position: { x: 80, y: 120 } },
      {
        id: 'destination',
        kind: 'destination',
        label: 'Destination',
        config: {},
        position: { x: 520, y: 120 },
      },
    ],
    edges: [{ from: 'source', to: 'destination' }],
    trigger: 'manual',
  };
}
