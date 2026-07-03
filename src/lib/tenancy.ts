import { auth } from '@/auth';

// Multi-tenancy spine (Phase 3). Every tenant-scoped row carries an `org_id`. Until full
// per-org provisioning lands, all data lives in the DEFAULT_ORG, so existing single-tenant
// behavior is preserved (columns default to 'default', queries fall back to it). The org is
// resolved from the signed-in principal; the resolution rule is centralized HERE so we can
// evolve it (email domain → Keycloak org claim → explicit membership) without touching callers.
export const DEFAULT_ORG = 'default';

// Map an authenticated principal to their org. Order of precedence:
//   1. explicit OFFGRID_ORG override (single-tenant deploys pin one org)
//   2. a Keycloak `org` / `organization` claim (future: real per-org tokens)
//   3. DEFAULT_ORG
// Kept deterministic + side-effect free so it's safe to call on any request.
export async function currentOrgId(): Promise<string> {
  if (process.env.OFFGRID_ORG) return process.env.OFFGRID_ORG;
  const session = (await auth()) as { user?: { org?: string } } | null;
  const claim = session?.user?.org;
  return (typeof claim === 'string' && claim.trim()) ? claim.trim() : DEFAULT_ORG;
}

// Resolve an org for a service/machine principal given its already-verified claims (no session).
export function orgFromClaims(claims: { org?: unknown } | null | undefined): string {
  if (process.env.OFFGRID_ORG) return process.env.OFFGRID_ORG;
  const o = claims?.org;
  return (typeof o === 'string' && o.trim()) ? o.trim() : DEFAULT_ORG;
}
