// Pure view-model helpers for the Access → User detail surface (`/governance/access/[id]`).
// Zero I/O — unit-testable. The detail PANEL owns fetching; these shape the data it renders.

import type { KcRole } from './keycloak-admin';

// Diff a user's currently-assigned realm roles against the checked set the operator wants, yielding
// the minimal add/remove role lists to send to the (existing) POST/DELETE roles routes. Idempotent:
// a role already assigned and still checked is neither added nor removed. `all` is the full realm
// role catalog — only roles that exist in it can be assigned/removed.
export interface RoleDiff {
  toAdd: KcRole[];
  toRemove: KcRole[];
}

export function diffRoles(all: KcRole[], assigned: string[], checked: Iterable<string>): RoleDiff {
  const assignedSet = new Set(assigned);
  const checkedSet = new Set(checked);
  return {
    toAdd: all.filter((r) => checkedSet.has(r.name) && !assignedSet.has(r.name)),
    toRemove: all.filter((r) => !checkedSet.has(r.name) && assignedSet.has(r.name)),
  };
}

// A user's display name for headers/toasts: full name if present, else username, else email, else id.
export function userDisplayName(u: {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  id: string;
}): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return full || u.username || u.email || u.id;
}

// The identity line under the name — email if present, else username, else id.
export function userSubtitle(u: { email?: string; username?: string; id: string }): string {
  return u.email || u.username || u.id;
}

// ── User edit (identity) ─────────────────────────────────────────────────────────
// The editable identity fields the console exposes on the user detail page. `username` is NOT
// editable here — it is the login handle (and, in this realm, the email), changed only by recreating
// the user. `enabled` is toggled by the disable/enable action, which reuses the same PATCH route.
export interface UserEditInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled?: boolean;
}

// A permissive email shape check — enough to catch a fat-fingered address before it reaches
// Keycloak, without pretending to be RFC 5322. Keycloak enforces its own policy on top.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate + normalize an edit into the minimal Keycloak user patch to PUT. Only provided fields are
// included (so a partial edit never clears untouched fields). Trims strings; an empty first/last
// name is allowed (clears the field) but an empty/invalid email is rejected. Returns { error } on a
// bad value so the route + form stay thin. Pure — unit-testable, zero-IO.
export function validateUserEdit(
  input: UserEditInput,
): { patch: UserEditInput } | { error: string } {
  const patch: UserEditInput = {};
  if (input.firstName !== undefined) patch.firstName = input.firstName.trim();
  if (input.lastName !== undefined) patch.lastName = input.lastName.trim();
  if (input.email !== undefined) {
    const email = input.email.trim();
    if (!email) return { error: 'email cannot be empty' };
    if (!EMAIL_RE.test(email)) return { error: 'email is not a valid address' };
    patch.email = email;
  }
  if (input.emailVerified !== undefined) {
    if (typeof input.emailVerified !== 'boolean') return { error: 'emailVerified must be a boolean' };
    patch.emailVerified = input.emailVerified;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') return { error: 'enabled must be a boolean' };
    patch.enabled = input.enabled;
  }
  if (Object.keys(patch).length === 0) return { error: 'no fields to update' };
  return { patch };
}
