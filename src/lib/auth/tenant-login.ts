import type { AppUser } from '@/lib/auth/identity';
import { tenantSlugFromHost } from '@/lib/route-access';
import { getTenantBySlug } from '@/lib/store';
import { mayLoginToTenant } from '@/lib/tenancy-policy';

// Impure adapter for the tenant-login gate (pure rule = mayLoginToTenant). Given the request Host
// (the TRUSTED host behind Cloudflare) and the just-authenticated user, decide whether the sign-in
// is allowed on THIS tenant subdomain. A non-member of the host's tenant is rejected (returns null),
// so the same credentials can't log into both the bank and the insurer host, and the rejection is
// indistinguishable from a bad password (no cross-tenant account disclosure). Node-only (DB lookup)
// so it must never be imported into the edge middleware bundle — auth.config imports it dynamically.
export async function gateTenantLogin(
  host: string | null | undefined,
  user: AppUser,
): Promise<AppUser | null> {
  const slug = tenantSlugFromHost(host);
  if (!slug) return user; // apex / non-tenant host — no per-tenant login gate
  const tenant = await getTenantBySlug(slug).catch(() => null);
  const tenantOrg = tenant?.id ?? null; // a tenant's id IS its org_id
  return mayLoginToTenant(tenantOrg, user.org, user.role) ? user : null;
}
