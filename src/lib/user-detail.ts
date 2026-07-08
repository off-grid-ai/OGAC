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
