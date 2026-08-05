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
  if (envOverride?.trim()) return envOverride.trim();
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

/**
 * Reverse-map an org id to its tenant slug. Used by the AUTHENTICATED in-app surfaces (e.g. the
 * read-only-demo hellobar) to resolve "which tenant am I in" from the SIGNED-IN principal's org
 * rather than the request host — because a client-side RSC navigation can render a shared layout in
 * a host-ambiguous context (the host header isn't reliably the tenant subdomain), so keying the
 * banner off the host flapped to the generic pair. The session org is stable across render context
 * and router cache, so it is the correct source post-auth. Returns null when the org is unset or has
 * no matching tenant (single-tenant / apex deploys). Pure — tenant list + org id in, slug out.
 */
export function slugForOrg(
  tenants: ReadonlyArray<{ id: string; slug: string | null }>,
  orgId: string | null | undefined,
): string | null {
  if (!orgId) return null;
  return tenants.find((t) => t.id === orgId)?.slug ?? null;
}

/**
 * LOGIN gate for a tenant subdomain (distinct from bindTenantOrg's data-scoping). A person may
 * sign IN on a tenant's host ONLY if they are a platform admin OR a member of THAT tenant's org.
 * So the SAME credentials cannot log into both the bank host and the insurer host — each tenant is
 * its own island, and a non-member login is rejected exactly like a bad password (the caller returns
 * null → the standard invalid-credentials UX), never revealing the account exists on another tenant.
 * Off a tenant subdomain (`tenantOrg` null — apex / single-tenant deploy) there is no gate: allowed.
 */
export function mayLoginToTenant(
  tenantOrg: string | null,
  userOrg: string | null | undefined,
  role: string | undefined,
): boolean {
  if (!tenantOrg) return true;
  if (role === 'admin') return true;
  return !!userOrg && userOrg === tenantOrg;
}

/**
 * The tenant ADMIN LIST boundary (found live 2026-08-05: `/operations/admin/tenants` rendered every
 * tenant's name/host/plan identically on both demo tenants — a read-only viewer on either public
 * demo link learned who the other customers were). `listTenants()` returns the whole platform
 * directory with no org awareness at all, so the boundary has to be applied by every caller.
 *
 * The rule mirrors `bindTenantOrg`: `callerOrg` is already the EFFECTIVE org from `currentOrgId()`,
 * which hard-binds a subdomain admin and never widens a non-member's scope — so DEFAULT_ORG here means
 * "not bound to any tenant," i.e. a genuine platform operator, who sees every tenant (this is the
 * existing tenant-provisioning surface). Any other caller is a member of exactly ONE tenant and sees
 * ONLY that tenant's own row — never another's, and never "all" as a fallback.
 */
export function visibleTenants<T extends { id: string }>(
  tenants: readonly T[],
  callerOrg: string,
): T[] {
  if (callerOrg === DEFAULT_ORG) return [...tenants];
  return tenants.filter((t) => t.id === callerOrg);
}

/**
 * Whether `callerOrg` may create/edit/delete the tenant `targetId` (the WRITE side of the same
 * boundary — `PATCH`/`DELETE /api/v1/admin/tenants/[id]` took an id with no org check at all, so any
 * caller who cleared `requireAdmin` could edit or delete ANOTHER tenant's row by guessing its id).
 * Same shape as `visibleTenants`: a platform operator (DEFAULT_ORG) manages every tenant; anyone else
 * manages only their own. There is no target for CREATE (a brand-new tenant has no id yet) — callers
 * gate that action on `callerOrg === DEFAULT_ORG` directly.
 */
export function mayManageTenant(callerOrg: string, targetId: string): boolean {
  return callerOrg === DEFAULT_ORG || callerOrg === targetId;
}
