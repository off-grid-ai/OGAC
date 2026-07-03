import { auth } from '@/auth';
import { DEFAULT_ORG, resolveOrg } from '@/lib/tenancy-policy';

// Multi-tenancy spine (Phase 3). Every tenant-scoped row carries an `org_id`. The pure
// resolution RULE lives in tenancy-policy.ts (zero imports → unit-testable, no mocks); these
// are the impure ADAPTERS that feed the session / verified-claims into it.
export { DEFAULT_ORG, resolveOrg };

// Session adapter — for server components / route handlers with a user session.
export async function currentOrgId(): Promise<string> {
  const session = (await auth()) as { user?: { org?: string } } | null;
  return resolveOrg(session?.user?.org, process.env.OFFGRID_ORG);
}

// Claims adapter — for machine/service principals whose JWT was already verified.
export function orgFromClaims(claims: { org?: unknown } | null | undefined): string {
  return resolveOrg(claims?.org, process.env.OFFGRID_ORG);
}
