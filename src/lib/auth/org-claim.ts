// The single source of truth for reading a caller's tenant org from decoded token/profile claims.
// PURE and ZERO-IO (no fetch/Buffer/imports), so it is safe to import from BOTH the server-only
// identity adapter (ROPC path) AND the Edge-shared auth.config (the OIDC jwt branch, which the
// middleware bundles) without dragging server code into the Edge bundle. Kept here — not inlined in
// each caller — so the claim-shape contract is defined once (DRY): the Keycloak protocol mapper's
// claim name is asserted against ONE reader.
//
// Precedence, first non-empty wins:
//   1. a top-level `org` claim (the canonical mapper output),
//   2. an `organization` string claim (alternative single-value mapper),
//   3. the first entry of an `organization` GROUP claim (an array, e.g. group membership).
// Returns undefined when none is present, so the caller falls back to the default org (no binding).
export function orgFromClaims(p: Record<string, unknown>): string | undefined {
  const org = p['org'];
  if (typeof org === 'string' && org.trim()) return org.trim();
  const organization = p['organization'];
  if (typeof organization === 'string' && organization.trim()) return organization.trim();
  if (Array.isArray(organization)) {
    const first = organization.find((v) => typeof v === 'string' && v.trim());
    if (typeof first === 'string') return first.trim();
  }
  return undefined;
}
