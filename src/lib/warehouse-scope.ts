// Impure ADAPTER that resolves the current request's warehouse (ClickHouse) DATABASE scope, then
// feeds it into the pure warehouse-tenancy rules. SoC: the tenancy boundary DECISIONS live in
// warehouse-tenancy.ts (zero-IO, unit-tested); the org→database lookup (which needs the session +
// the tenants table) lives here, out of both the pure rules and the ClickHouse adapter.
//
// The warehouse database a tenant may read is named by its SLUG (e.g. org_bharat → `bharatunion`),
// per deploy/onprem/SERVER_STATE.md. We resolve the EFFECTIVE org via currentOrgId() (which already
// applies the hard-binding rule — an admin on a tenant subdomain binds to it, a non-member stays in
// their own org, so this can never widen a viewer's scope) and map it to that org's slug. The
// default / single-tenant org (no matching tenant row) → ALL_DATABASES (unscoped, backwards-compat).

import { listTenants } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { warehouseDatabaseForSlug, type ALL_DATABASES } from '@/lib/warehouse-tenancy';

/**
 * The ClickHouse database the current viewer is scoped to (their tenant slug), or ALL_DATABASES
 * (null) for the default / single-tenant org. Reads the effective org from currentOrgId() and maps
 * it to its tenant slug via the tenants table. Fail-safe: any lookup error degrades to the current
 * org's own scope — never another tenant's — and a DEFAULT_ORG viewer is always unscoped.
 */
export async function currentWarehouseDatabase(): Promise<string | typeof ALL_DATABASES> {
  const org = await currentOrgId();
  if (org === DEFAULT_ORG) return warehouseDatabaseForSlug(null);
  try {
    const tenants = await listTenants();
    const tenant = tenants.find((t) => t.id === org);
    return warehouseDatabaseForSlug(tenant?.slug ?? null);
  } catch {
    // Can't resolve the slug (DB down / non-request context) — do NOT fall back to unscoped, which
    // would leak every tenant's tables. A tenant org with an unknown slug sees NOTHING (fail-closed).
    return org;
  }
}
