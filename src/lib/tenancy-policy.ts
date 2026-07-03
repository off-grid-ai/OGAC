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
