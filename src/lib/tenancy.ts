import { cache } from 'react';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireUser } from '@/lib/authz';
import { getTenantBySlug } from '@/lib/store';
import { DEFAULT_ORG, bindTenantOrg, resolveOrg } from '@/lib/tenancy-policy';

// Multi-tenancy spine (Phase 3). Every tenant-scoped row carries an `org_id`. The pure
// resolution RULE lives in tenancy-policy.ts (zero imports → unit-testable, no mocks); these
// are the impure ADAPTERS that feed the session / verified-claims into it.
export { DEFAULT_ORG, bindTenantOrg, resolveOrg };

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

// Decode a JWT payload WITHOUT verifying it — used ONLY to read a non-authorizing routing hint (the
// `org` / `organization` claim) AFTER the bearer has already been verified by the authz seam
// (requireUser). Signature/expiry/issuer are the seam's job; this just surfaces which org an
// org-scoped service key claims to belong to. Returns null on any malformed token.
function orgClaimFromJwt(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const c = JSON.parse(json) as Record<string, unknown>;
    const org = c['org'] ?? c['organization'];
    return typeof org === 'string' && org.trim() ? org.trim() : undefined;
  } catch {
    return undefined;
  }
}

// Resolve the actor (role + own org) for THIS request from the SAME principal the authz gates
// verify: prefer an interactive session; otherwise fall back to the verified bearer / break-glass
// admin token. This is what makes host→org binding engage for a service/machine request — before
// the fix currentOrgId() looked at auth() alone, so a bearer request had role=undefined and never
// bound the subdomain's org. Fail-safe: an unverifiable bearer yields no elevation (default role/org).
const requestActor = cache(async (): Promise<{ org: string; role: string | undefined }> => {
  const session = (await auth()) as { user?: { email?: string | null; org?: string; role?: string } } | null;
  if (session?.user?.email) {
    return { org: resolveOrg(session.user.org, process.env.OFFGRID_ORG), role: session.user.role };
  }
  // No interactive session — resolve a bearer/service principal exactly as the API gates do.
  try {
    const authHeader = (await headers()).get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return { org: resolveOrg(undefined, process.env.OFFGRID_ORG), role: undefined };
    }
    const gate = await requireUser(new Request('http://internal/', { headers: { authorization: authHeader } }));
    if (gate instanceof NextResponse) {
      return { org: resolveOrg(undefined, process.env.OFFGRID_ORG), role: undefined };
    }
    // A verified principal. Its own org is any `org` claim on the token (org-scoped service key);
    // absent that it's the default (or the env-pinned single-tenant org). The break-glass admin
    // token carries no org claim → default org, admin role.
    const token = authHeader.slice(7).trim();
    return { org: resolveOrg(orgClaimFromJwt(token), process.env.OFFGRID_ORG), role: gate.user.role };
  } catch {
    // Non-request context (worker/script) or header read failed — safe default.
    return { org: resolveOrg(undefined, process.env.OFFGRID_ORG), role: undefined };
  }
});

// The org-scoping adapter for server components AND route handlers, session- or bearer-authenticated.
// HARD-BINDING: on a tenant's own subdomain the console is scoped to THAT tenant's org, so its data is
// isolated. The pure rule (bindTenantOrg) binds only for an admin actor or a member of that org —
// otherwise the caller keeps their own org, so a subdomain can never leak another tenant's data.
export async function currentOrgId(): Promise<string> {
  const { org: actorOrg, role } = await requestActor();
  const tenantOrg = await tenantOrgFromHost();
  return bindTenantOrg(tenantOrg, actorOrg, role);
}

// Claims adapter — for machine/service principals whose JWT was already verified.
export function orgFromClaims(claims: { org?: unknown } | null | undefined): string {
  return resolveOrg(claims?.org, process.env.OFFGRID_ORG);
}
