// PURE user-directory TENANCY logic — ZERO imports, ZERO I/O, fully unit-testable.
//
// The Access → Users tab renders users fetched from Keycloak, which is a REALM-WIDE identity store
// with no reliable per-user org attribute. On a multi-tenant realm that means one tenant's admin saw
// EVERY realm user — the bank's "Bharat Demo" user and internal staff alongside the insurer's own
// (the SURFACE-1 leak). Org MEMBERSHIP is owned by the console DB (`users.org_id`), which is what
// currentOrgId / sign-in already trust. So the fix is an INTERSECTION: keep only the realm users
// whose email belongs to the caller's org per the DB. This module is that pure decision.
//
// Single-tenant / default-org safety: when the caller's org is the default (unstamped) org we do NOT
// intersect — the realm IS the tenant, and the DB may not mirror every federated user. Callers pass
// `scoped: false` in that case and the realm list is returned as-is (behaviour unchanged).

// A minimal shape over a Keycloak user — only the email is load-bearing for scoping. Generic so the
// caller keeps its own richer KcUser type (id/roles/enabled) on the returned rows.
export interface HasEmail {
  email?: string | null;
  username?: string | null;
}

/** Normalise an email/username for case-insensitive membership comparison. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Build the set of emails that belong to an org, from the DB member rows. Case-insensitive; blanks
 * dropped. Kept separate so the route can feed `listUsers(orgId)` straight in.
 */
export function orgMemberEmailSet(members: ReadonlyArray<{ email?: string | null }>): Set<string> {
  const set = new Set<string>();
  for (const m of members) {
    const e = norm(m.email);
    if (e) set.add(e);
  }
  return set;
}

/**
 * Scope a realm-wide Keycloak user list to one tenant.
 *
 *   - `scoped: false` (default/single-tenant org) → return the list unchanged; the realm is the
 *     tenant, and the DB isn't the authority there.
 *   - `scoped: true` → keep ONLY users whose email is in `orgEmails` (the DB members of the caller's
 *     org). A realm user with no matching org membership is dropped, so a tenant never sees another
 *     tenant's users or internal staff. Matching falls back to `username` when `email` is absent
 *     (Keycloak often stores the email as the username).
 *
 * Pure: the caller resolves `orgEmails` (DB) and `scoped` (is this a real tenant org?) via the
 * impure seam, then this decides what renders.
 */
export function scopeKeycloakUsersToOrg<T extends HasEmail>(
  users: readonly T[],
  orgEmails: ReadonlySet<string>,
  scoped: boolean,
): T[] {
  if (!scoped) return [...users];
  return users.filter((u) => {
    const email = norm(u.email) || norm(u.username);
    return email !== '' && orgEmails.has(email);
  });
}
