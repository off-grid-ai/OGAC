// Pure multi-tenancy policy — ZERO imports, so it's unit-testable in isolation (no Next/auth
// chain). This is the single source of truth for which org a principal belongs to; the adapters
// in tenancy.ts (session / verified-claims) feed inputs into it. Keeping the rule dependency-free
// is the SOLID seam: policy here, I/O there.
export const DEFAULT_ORG = 'default';

/**
 * Resolve a principal's org. Precedence:
 *   1. explicit env override (single-tenant deploys pin one org)
 *   2. a Keycloak `org` / `organization` claim (real per-org tokens)
 *   3. DEFAULT_ORG
 */
export function resolveOrg(claim: unknown, envOverride?: string): string {
  if (envOverride && envOverride.trim()) return envOverride.trim();
  if (typeof claim === 'string' && claim.trim()) return claim.trim();
  return DEFAULT_ORG;
}

/**
 * Decide the effective org for a request on a tenant subdomain (the HARD-BINDING rule).
 *
 * Inputs (all resolved by the impure adapters in tenancy.ts, from the SAME principal the authz
 * gates verify — an interactive session OR a verified bearer / break-glass admin token):
 *   - `tenantOrg`  the org mapped from the TRUSTED subdomain host (null off a tenant subdomain)
 *   - `actorOrg`   the org the caller already belongs to (session org, service-key org claim, or default)
 *   - `role`       the caller's resolved role ('admin' for a platform / break-glass / console-admin actor)
 *
 * A subdomain may bind its org ONLY when the caller is authorized for it — a platform **admin**, or a
 * caller who ALREADY belongs to that org. Any other caller stays in their own org, so a subdomain can
 * never leak another tenant's data (fail SAFE). This is intentionally identical for an interactive
 * session and a bearer/service principal: authorization comes from the verified principal, never from
 * the mere fact that a credential was presented on that host.
 */
export function bindTenantOrg(
  tenantOrg: string | null,
  actorOrg: string,
  role: string | undefined,
): string {
  if (tenantOrg && tenantOrg !== actorOrg) {
    return role === 'admin' ? tenantOrg : actorOrg;
  }
  return tenantOrg ?? actorOrg;
}
