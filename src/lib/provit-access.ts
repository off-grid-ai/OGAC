import { NextResponse } from 'next/server';
import { and, eq, or, type SQL } from 'drizzle-orm';
import { auth } from '@/auth';
import { provitRepos, provitRuns } from '@/db/schema';
import { requireUser } from '@/lib/authz';
import { effectiveBaseRole } from '@/lib/module-access';
import { verifyToken } from '@/lib/provit-token';
import { evaluateAbac } from '@/lib/store';
import { currentOrgId, DEFAULT_ORG } from '@/lib/tenancy';

// Single Provit access layer — inherits the console's RBAC + ABAC + tenancy rather than
// reinventing it. Three layers, in order:
//   1. RBAC  — requireModuleForUser('provit') gates the module (done at the page/route).
//   2. ABAC  — abac_rules with resource='provit' (deny-overrides via evaluateAbac). Admin never
//              denied; no rule → allowed (fail-open refinement, like chat-governance).
//   3. Tenancy — row visibility: public (demo library) ∪ own org ∪ own private.

export interface ProvitPrincipal { email: string; role: string; orgId: string }

export async function currentPrincipal(): Promise<ProvitPrincipal> {
  const session = (await auth()) as { user?: { email?: string; role?: string } } | null;
  return {
    email: session?.user?.email ?? '',
    role: session?.user?.role ?? 'viewer',
    orgId: await currentOrgId(),
  };
}

/** ABAC: may this principal perform `action` (e.g. 'read' | 'write') on Provit? Deny-overrides;
 *  admin always allowed; absent rules → allowed. Custom roles inherit their base role. */
export async function provitAbacAllows(p: ProvitPrincipal, action: string): Promise<boolean> {
  if (p.role === 'admin') return true;
  const base = await effectiveBaseRole(p.role);
  if (base === 'admin') return true;
  // Deny-overrides: a matching deny for either the role or its base blocks.
  for (const role of new Set([p.role, base])) {
    const { allow, matched } = await evaluateAbac({ role, resource: 'provit', attributes: { action } });
    if (matched.some((r) => r.effect === 'deny')) return false;
    if (!allow && matched.length > 0) return false;
  }
  return true; // no governing rule → allowed (RBAC module gate already applied)
}

/** Tenancy row filter for a Provit table (repos|runs): public ∪ own org ∪ own private. */
export function visibilityFilter(table: typeof provitRepos | typeof provitRuns, p: ProvitPrincipal): SQL | undefined {
  return or(
    eq(table.visibility, 'public'),
    and(eq(table.visibility, 'org'), eq(table.orgId, p.orgId)),
    and(eq(table.visibility, 'private'), eq(table.ownerId, p.email)),
  );
}

export interface PushPrincipal { orgId: string; ownerId: string; visibility: 'public' | 'org' }

/**
 * Who is pushing? A Provit INTEGRATION TOKEN (Bearer pvt_…) binds the push to the issuer's org
 * → attributed as team data (visibility='org'). Otherwise a valid service/user JWT falls back to
 * the PUBLIC LIBRARY (the no-login demo). Returns a 401 response if neither authenticates.
 */
export async function resolvePushPrincipal(req: Request): Promise<PushPrincipal | NextResponse> {
  const h = req.headers.get('authorization') ?? '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (bearer.startsWith('pvt_')) {
    const binding = await verifyToken(bearer);
    if (binding) return { orgId: binding.orgId, ownerId: binding.ownerId, visibility: 'org' };
    return NextResponse.json({ error: 'invalid or revoked Provit token' }, { status: 401 });
  }
  const gate = await requireUser(req); // service-account JWT / session / break-glass → public library
  if (gate instanceof NextResponse) return gate;
  const email = (gate as { user?: { email?: string } }).user?.email ?? 'provit';
  return { orgId: DEFAULT_ORG, ownerId: email, visibility: 'public' };
}
