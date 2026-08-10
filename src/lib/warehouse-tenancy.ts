// Pure, zero-IO rules for TENANT-SCOPING the warehouse (ClickHouse) read path. The warehouse is a
// shared ClickHouse where each tenant's tables live in its OWN database, named by the tenant slug
// (e.g. bharatunion, suraksha — see deploy/onprem/SERVER_STATE.md). Without a scope every tenant saw
// every database's tables + could read `other_db.table` (adversarial G-ADV-DATA-5). These functions
// are the single tested place that decides "which database is this viewer allowed to see" and
// "does this table name escape that database" — the adapter (I/O) resolves the slug and applies them.
//
// SoC: policy here (dependency-free, unit-testable), the header/DB lookup + SQL in the adapter.

// The single-tenant / apex sentinel: NO tenant subdomain in play, so the console is the whole
// deployment and every non-system database is in scope (backwards-compatible with pre-tenant deploys).
export const ALL_DATABASES = null;

/**
 * The ClickHouse database a viewer is scoped to. On a tenant subdomain the slug IS the database
 * name; off it (apex / single-tenant) → ALL_DATABASES (no scope). A blank/whitespace slug is treated
 * as no-slug → ALL_DATABASES, never an empty-string database that would match nothing by accident.
 */
export function warehouseDatabaseForSlug(slug: string | null | undefined): string | null {
  const s = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  return s ? s : ALL_DATABASES;
}

/**
 * Keep only the tables a scoped viewer may see. `database === ALL_DATABASES` (null) → unscoped, the
 * full list passes through. Otherwise only tables whose `database` equals the scope survive; a table
 * with no database field is dropped under a scope (fail-closed — never leak an unattributed table).
 */
export function scopeTablesToDatabase<T extends { database?: string }>(
  tables: readonly T[],
  database: string | null,
): T[] {
  if (database === ALL_DATABASES) return [...tables];
  return tables.filter((t) => t.database === database);
}

/**
 * Guard a single table reference (from a detail/stats/sample/query path) against the viewer's scope.
 * The name may be bare (`events`) or qualified (`db.events`). Rules:
 *   • unscoped (ALL_DATABASES) → always allowed (single-tenant);
 *   • a BARE name is allowed — it resolves against the scoped database, applied by the adapter;
 *   • a QUALIFIED name is allowed ONLY when its database prefix equals the scope; any other
 *     database (e.g. another tenant's) is DENIED — this is the fix for the cross-tenant
 *     `SELECT * FROM other_org_db.accounts` read.
 * Returns true when the reference is in-scope. Malformed/multi-dot names are the adapter's identifier
 * validator's job; this only decides the tenancy boundary.
 */
export function tableInScope(name: string, database: string | null): boolean {
  if (database === ALL_DATABASES) return true;
  const dot = name.indexOf('.');
  if (dot === -1) return true; // bare name → resolved within the scoped database by the adapter
  const prefix = name.slice(0, dot).trim().toLowerCase();
  return prefix === database;
}

/**
 * Reject an operator SQL statement that reaches outside the viewer's own warehouse database. PURE.
 *
 * WHY THIS EXISTS. `listTables`, `tableStats` and `sample` were all scoped through the helpers above.
 * The operator SQL console was not: `POST /api/v1/admin/warehouse/query` handed the statement
 * straight to ClickHouse, and the only guard in front of it checked that the verb was a read. So a
 * `SELECT … FROM <other tenant>.fact_claim` was a valid, executable query.
 *
 * It was not theoretical. The insurer's own suggested starter queries were hardcoded to
 * `FROM bfsi.fact_claim` and `FROM bfsi.fact_kyc_event` — another database entirely — so the shortest
 * path to reading someone else's rows was to click a button the product itself offered.
 *
 * HOW IT DECIDES. Every `database.table` reference in the statement must name the viewer's database.
 * An UNQUALIFIED table (`FROM fact_policy`) is fine: the connection's own default database applies,
 * and that is the viewer's. Anything qualified with a different database is refused by name.
 *
 * Deliberately a denylist-of-references and not a SQL parser. It runs AFTER `guardReadOnlySql`, which
 * has already rejected comments, semicolons and every non-read verb — so the input here is a single
 * read statement, and the shapes a reference can take are narrow.
 */
export function assertQueryInScope(
  sql: string,
  database: string | null,
): { ok: true } | { ok: false; reason: string } {
  const text = String(sql ?? '');
  // ALL_DATABASES (the platform operator) is unscoped by design — it administers every tenant.
  if (database === ALL_DATABASES) return { ok: true };
  if (!database) return { ok: false, reason: 'no warehouse scope for this account' };

  // `db.table` after FROM/JOIN/INTO, plus bare `db.table` anywhere (a subquery, a UNION arm).
  const refs = new Set<string>();
  for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    refs.add(m[1].toLowerCase());
  }
  // ClickHouse's own schema databases are readable by anyone and carry no tenant rows.
  const OPEN = new Set(['system', 'information_schema']);
  const foreign = [...refs].filter((db) => db !== database.toLowerCase() && !OPEN.has(db));
  if (foreign.length > 0) {
    return {
      ok: false,
      // Name what was refused and what IS allowed. "forbidden" on its own taught the reader nothing
      // and made a working guard look like a broken page.
      reason: `this account can only query the "${database}" database — remove the reference to "${foreign[0]}"`,
    };
  }
  return { ok: true };
}
