// ─── Analytical-model schema DDL — PURE logic, zero I/O ───────────────────────
// SOLID: every DDL string, guard, and migration/version computation lives here as a pure function.
// The warehouse adapter (src/lib/adapters/warehouse.ts execDdl) does ONLY the ClickHouse HTTP I/O;
// the store (src/lib/schema-model-store.ts) does ONLY persistence. This file decides WHAT DDL runs
// and validates it, so a governed "analytical model" (a view / materialized view / table over the
// warehouse) is created and migrated safely with no unvalidated SQL ever reaching ClickHouse.
//
// Reuses the warehouse-model guards (isSafeIdentifier / quoteIdentifier / guardReadOnlySql) so the
// injection surface is closed in ONE place (DRY) — a model's SELECT body is held to the same
// read-only, no-dangerous-table-function bar as an operator's ad-hoc query.

import {
  guardReadOnlySql,
  isSafeIdentifier,
  quoteIdentifier,
  type GuardResult,
} from '@/lib/warehouse-model';

export type ModelKind = 'view' | 'materialized_view' | 'table';

export const MODEL_KINDS: readonly ModelKind[] = ['view', 'materialized_view', 'table'];

export function isModelKind(v: unknown): v is ModelKind {
  return typeof v === 'string' && (MODEL_KINDS as readonly string[]).includes(v);
}

// The ClickHouse table engines an operator may pick for a materialized-view target or a table model.
// A small closed allow-list — arbitrary engines (Kafka/S3/URL/MySQL/…) are OUT because they reach
// out of the warehouse (the same SSRF/exfil surface guardReadOnlySql closes for table functions).
export const ALLOWED_ENGINES: readonly string[] = [
  'MergeTree',
  'ReplacingMergeTree',
  'SummingMergeTree',
  'AggregatingMergeTree',
  'Memory',
  'Log',
  'TinyLog',
  'StripeLog',
];

export function isAllowedEngine(engine: unknown): boolean {
  return typeof engine === 'string' && ALLOWED_ENGINES.includes(engine);
}

// The definition an operator submits. A view/materialized_view is defined by a SELECT; a table by a
// columns spec (+ engine + optional ORDER BY). materialized_view also needs an engine + ORDER BY to
// store its result.
export interface ModelDefinition {
  selectSql?: string; // view / materialized_view
  columns?: string; // table: "id UInt64, name String, amount Decimal(18,2)"
  engine?: string; // materialized_view / table
  orderBy?: string; // materialized_view / table
}

export interface ModelInput {
  name: string;
  kind: ModelKind;
  database?: string;
  definition: ModelDefinition;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// A model SELECT body is held to the read-only query bar (single statement, read verb only, no
// dangerous table functions). We reuse guardReadOnlySql so the rule lives in one place.
export function guardModelSelect(sql: unknown): GuardResult {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'SELECT body is required' };
  const guard = guardReadOnlySql(sql);
  if (!guard.ok) return guard;
  const leader = /^([A-Za-z]+)/.exec(sql.trim())?.[1]?.toUpperCase();
  if (leader !== 'SELECT' && leader !== 'WITH') {
    return { ok: false, reason: 'a model body must be a SELECT (or WITH … SELECT)' };
  }
  return { ok: true };
}

// A table columns spec: comma-separated `<identifier> <type>` pairs. We forbid the characters that
// could break out of the DDL (`;` statement-stacking, quotes, comment markers, backticks) and
// require each part to start with a safe identifier. Types may carry parens/commas/spaces
// (Decimal(18, 2), Nullable(String), Array(UInt8)) so we don't over-constrain the type text.
const UNSAFE_DDL_CHARS = /[;'"`]|--|\/\*|\*\/|#/;
const COLUMN_DEF = /^\s*[A-Za-z_][A-Za-z0-9_]*\s+[A-Za-z][A-Za-z0-9_(),\s]*$/;

export function validateColumnsDdl(columns: unknown): boolean {
  if (typeof columns !== 'string' || !columns.trim()) return false;
  if (UNSAFE_DDL_CHARS.test(columns)) return false;
  // Split on top-level commas is hard with parenthesised types; instead validate the whole string
  // as a set of column-like tokens. Balanced parens + every comma-free segment (outside parens)
  // starting with an identifier + type is enough given UNSAFE_DDL_CHARS already blocks escapes.
  if (!balancedParens(columns)) return false;
  const parts = splitTopLevel(columns, ',');
  if (parts.length === 0) return false;
  return parts.every((p) => COLUMN_DEF.test(p));
}

// An ORDER BY / engine argument expression: identifiers, commas, parens, dots, spaces only. No
// escapes (UNSAFE_DDL_CHARS) so it can't break out of the DDL. Empty is allowed (caller decides).
const SAFE_EXPR = /^[A-Za-z0-9_(),.\s]*$/;

export function validateExpr(expr: unknown): boolean {
  return typeof expr === 'string' && !UNSAFE_DDL_CHARS.test(expr) && SAFE_EXPR.test(expr) && balancedParens(expr);
}

// Validate a whole model definition for its kind. Returns every problem at once.
export function validateModelInput(input: ModelInput): ValidationResult {
  const errors: string[] = [];
  if (!isModelKind(input?.kind)) {
    errors.push(`kind must be one of: ${MODEL_KINDS.join(', ')}`);
  }
  if (!input?.name || !isSafeIdentifier(input.name) || input.name.includes('.')) {
    errors.push('name must be a simple safe identifier (letters, digits, underscore)');
  }
  if (input?.database && !isSafeIdentifier(input.database)) {
    errors.push('database must be a safe identifier');
  }
  const def = input?.definition ?? {};
  if (input?.kind === 'view' || input?.kind === 'materialized_view') {
    const guard = guardModelSelect(def.selectSql);
    if (!guard.ok) errors.push(guard.reason ?? 'invalid SELECT body');
  }
  if (input?.kind === 'materialized_view' || input?.kind === 'table') {
    if (!isAllowedEngine(def.engine)) {
      errors.push(`engine must be one of: ${ALLOWED_ENGINES.join(', ')}`);
    }
    if (def.orderBy !== undefined && def.orderBy !== '' && !validateExpr(def.orderBy)) {
      errors.push('orderBy contains unsupported characters');
    }
  }
  if (input?.kind === 'table') {
    if (!validateColumnsDdl(def.columns)) {
      errors.push('columns must be a safe comma-separated list of "<name> <type>" definitions');
    }
  }
  return { ok: errors.length === 0, errors };
}

// The fully-qualified, backtick-quoted object name. Assumes name/database already validated.
export function qualifiedName(name: string, database?: string): string {
  return database ? `${quoteIdentifier(database)}.${quoteIdentifier(name)}` : quoteIdentifier(name);
}

// The statement(s) that make the warehouse object MATCH the given definition. A view uses
// CREATE OR REPLACE (atomic swap). A materialized view / table can't be replaced in place, so the
// apply is DROP-then-CREATE — idempotent because both DROP and CREATE use IF (NOT) EXISTS.
export function buildApplyDdl(input: ModelInput): string[] {
  const q = qualifiedName(input.name, input.database);
  const def = input.definition;
  if (input.kind === 'view') {
    return [`CREATE OR REPLACE VIEW ${q} AS ${def.selectSql!.trim()}`];
  }
  if (input.kind === 'materialized_view') {
    const order = def.orderBy?.trim() ? ` ORDER BY ${def.orderBy.trim()}` : '';
    return [
      `DROP VIEW IF EXISTS ${q}`,
      `CREATE MATERIALIZED VIEW ${q} ENGINE = ${def.engine}${order} AS ${def.selectSql!.trim()}`,
    ];
  }
  // table
  const order = def.orderBy?.trim() ? ` ORDER BY ${def.orderBy.trim()}` : ' ORDER BY tuple()';
  return [
    `DROP TABLE IF EXISTS ${q}`,
    `CREATE TABLE ${q} (${def.columns!.trim()}) ENGINE = ${def.engine}${order}`,
  ];
}

// The statement that removes the object entirely (delete / rollback of a v1 create).
export function buildDropDdl(kind: ModelKind, name: string, database?: string): string {
  const q = qualifiedName(name, database);
  return kind === 'table' ? `DROP TABLE IF EXISTS ${q}` : `DROP VIEW IF EXISTS ${q}`;
}

export function nextVersion(current: number | null | undefined): number {
  const n = Number(current);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) + 1 : 1;
}

// ─── apply / rollback / drop PLANS (the single decision seam the routes call) ──
// A "plan" is validate-then-build in one place: the route never validates and builds separately
// (that would let the two drift). The I/O service (warehouse-model-service.ts) takes a plan's
// statements and hands them to the warehouse adapter's execDdl — it never decides WHAT DDL runs.
export type ApplyPlan =
  | { ok: true; statements: string[] }
  | { ok: false; errors: string[] };

// Plan the DDL that makes the warehouse object match a submitted definition (create OR edit — the
// statements are identical; whether it's v1 or vN is the store's concern). Validates first; an
// invalid input yields the collected errors and NO statements (fail-closed — nothing reaches CH).
export function planModelApply(input: ModelInput): ApplyPlan {
  const v = validateModelInput(input);
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, statements: buildApplyDdl(input) };
}

// Plan the DROP for a delete. Wrapped in an array so it feeds execDdl uniformly. Assumes the
// name/database were validated at create time (they're stored, not re-submitted).
export function planModelDrop(kind: ModelKind, name: string, database?: string | null): string[] {
  return [buildDropDdl(kind, name, database ?? undefined)];
}

// A minimal shape of a stored version row — just enough for the pure rollback decision, so this
// stays zero-IO (the real row is SchemaModelVersion in the store).
export interface VersionLike {
  version: number;
  applyDdl: string[];
}

export type RollbackPlan =
  | { ok: true; statements: string[] }
  | { ok: false; reason: string };

// Plan a rollback to a prior version: re-apply that version's FROZEN DDL exactly as it was applied
// (a view's CREATE OR REPLACE / a table's DROP+CREATE are both idempotent, so re-running is safe).
// Pointing at the current version is allowed (a no-op re-apply / repair). Rejects an unknown
// version or one whose frozen DDL is empty (nothing safe to re-run).
export function planRollback(
  versions: readonly VersionLike[],
  targetVersion: number,
): RollbackPlan {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    return { ok: false, reason: 'target version must be a positive integer' };
  }
  const found = versions.find((v) => v.version === targetVersion);
  if (!found) return { ok: false, reason: `version ${targetVersion} not found` };
  if (!Array.isArray(found.applyDdl) || found.applyDdl.length === 0) {
    return { ok: false, reason: `version ${targetVersion} has no recorded DDL to re-apply` };
  }
  return { ok: true, statements: found.applyDdl };
}

// ─── small pure helpers ───────────────────────────────────────────────────────
function balancedParens(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// Split on a delimiter that appears at the TOP level (paren depth 0), so a comma inside Decimal(18,2)
// doesn't split a column. Trims each piece and drops empties.
function splitTopLevel(s: string, delim: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === delim && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
