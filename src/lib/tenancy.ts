import { cache } from 'react';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import { getTenantBySlug } from '@/lib/store';
import { DEFAULT_ORG, resolveOrg } from '@/lib/tenancy-policy';

// Multi-tenancy spine (Phase 3). Every tenant-scoped row carries an `org_id`. The pure
// resolution RULE lives in tenancy-policy.ts (zero imports → unit-testable, no mocks); these
// are the impure ADAPTERS that feed the session / verified-claims into it.
export { DEFAULT_ORG, resolveOrg };

// Resolve the tenant org from the host, if this request is on a tenant subdomain
// (<slug>-onprem-console.*). The slug arrives as x-offgrid-tenant-slug, set by middleware from the
// TRUSTED host (client-supplied values are stripped there), so it can't be forged. Memoized per
// request (react cache) so the DB lookup runs at most once per request. Null off a tenant subdomain
// or in non-request contexts (workers/scripts, where headers() throws).
const tenantOrgFromHost = cache(async (): Promise<string | null> => {
  try {
    const slug = (await headers()).get('x-offgrid-tenant-slug');
    if (!slug) return null;
    const t = await getTenantBySlug(slug);
    return t?.id ?? null; // a tenant's id IS its org_id
  } catch {
    return null;
  }
});

// Session adapter — for server components / route handlers with a user session.
// HARD-BINDING: on a tenant's own subdomain the console is scoped to THAT tenant's org, so its data
// is isolated. Guard: the binding applies only for a platform admin or a user already in that org —
// otherwise we keep the user in their own org, so a subdomain can never leak another tenant's data.
export async function currentOrgId(): Promise<string> {
  const session = (await auth()) as { user?: { org?: string; role?: string } } | null;
  const sessionOrg = resolveOrg(session?.user?.org, process.env.OFFGRID_ORG);
  const tenantOrg = await tenantOrgFromHost();
  if (tenantOrg && tenantOrg !== sessionOrg) {
    return session?.user?.role === 'admin' ? tenantOrg : sessionOrg;
  }
  return tenantOrg ?? sessionOrg;
}

// Claims adapter — for machine/service principals whose JWT was already verified.
export function orgFromClaims(claims: { org?: unknown } | null | undefined): string {
  return resolveOrg(claims?.org, process.env.OFFGRID_ORG);
}
