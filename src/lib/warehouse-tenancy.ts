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
