// ─── App SHARING — PURE grant + upward-hierarchy resolution (zero-IO, unit-tested) ────────────────
//
// Keycloak is the identity + org-RBAC source of truth: every principal is an existing Keycloak user.
// On TOP of the per-app RBAC/ABAC policy (app-access-policy.ts) an app's CREATOR/owner can SHARE the
// app with specific Keycloak users at an app-role — Google-Doc-style sharing — and the creator's
// UPWARD management chain (their manager, that manager's manager, …) AUTOMATICALLY inherits access.
//
// This module owns, with NO DB/network, the two pure decisions the sharing layer adds:
//   1. GRANTS — an app-role (viewer/runner/approver/editor) → the set of AppActions it permits, and
//      whether a given user holds a grant admitting an action.
//   2. HIERARCHY — given the creator + the org-chart (teams + memberships + a per-team lead), resolve
//      the creator's upward management CHAIN (deduped, creator excluded), which auto-inherits access.
//
// Effective access = inherited org RBAC ∪ owner ∪ admins  (all in app-access-policy.ts)
//                    ∪ explicit per-app user grants        (here)
//                    ∪ the creator's upward management chain (here).
// evaluateShareAccess() composes 1+2 into a single {allow,reason}; app-access.ts unions it with the
// pure RBAC/ABAC decision so a caller is admitted if EITHER path allows (grants/hierarchy are additive
// — least-privilege still holds because absence of a grant/chain membership contributes nothing).

import { type AppAction } from '@/lib/app-access-policy';

// ─── the app-role vocabulary (the sharing ladder) ───────────────────────────────────────────────────
// A share grants ONE app-role. Roles are an ordered privilege ladder; each role's action set is a
// superset of the one below it. Deliberately NOT the same as a Keycloak realm role — this is a
// per-app capability level the creator hands out, independent of the user's org role.
export type AppShareRole = 'viewer' | 'runner' | 'approver' | 'editor';
export const APP_SHARE_ROLES: readonly AppShareRole[] = ['viewer', 'runner', 'approver', 'editor'];

// role → the AppActions it permits. Cumulative up the ladder:
//   viewer   → view
//   runner   → view, run, trigger
//   approver → view, run, trigger, approve
//   editor   → view, run, trigger, approve, edit  (full — same surface as the owner)
const SHARE_ROLE_ACTIONS: Record<AppShareRole, readonly AppAction[]> = {
  viewer: ['view'],
  runner: ['view', 'run', 'trigger'],
  approver: ['view', 'run', 'trigger', 'approve'],
  editor: ['view', 'run', 'trigger', 'approve', 'edit'],
};

export function isAppShareRole(v: unknown): v is AppShareRole {
  return typeof v === 'string' && (APP_SHARE_ROLES as readonly string[]).includes(v);
}

/** Coerce an untrusted value to a valid AppShareRole, defaulting to the least-privileged (viewer). PURE. */
export function normalizeShareRole(v: unknown): AppShareRole {
  return isAppShareRole(v) ? v : 'viewer';
}

/** The set of AppActions an app-role permits. PURE. */
export function actionsForShareRole(role: AppShareRole): readonly AppAction[] {
  return SHARE_ROLE_ACTIONS[role];
}

/** Does this app-role permit the given action? PURE. */
export function shareRolePermits(role: AppShareRole, action: AppAction): boolean {
  return SHARE_ROLE_ACTIONS[role].includes(action);
}

// ─── the stored grant shape ──────────────────────────────────────────────────────────────────────────
// One explicit share: a Keycloak user (by their stable id — email/username) at an app-role. Persisted
// as JSON on the app_access_policies row (see app-sharing.ts). `userId` is normalised (lower-cased)
// for case-insensitive matching against the caller's id.
export interface AppGrant {
  userId: string;
  role: AppShareRole;
}

/** Normalise a user id/email for comparison: trimmed + lower-cased. PURE. (Mirrors teams-policy.) */
export function normalizeUserId(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * Merge a grant into a list, upserting by user (re-granting a user REPLACES their role rather than
 * duplicating). Invalid users/roles are coerced; an empty user id is dropped. Returns a NEW list
 * (stable order: existing users keep position, a new user is appended). PURE.
 */
export function upsertGrant(grants: readonly AppGrant[], userId: unknown, role: unknown): AppGrant[] {
  const uid = normalizeUserId(userId);
  if (!uid) return grants.map((g) => ({ userId: normalizeUserId(g.userId), role: g.role }));
  const nextRole = normalizeShareRole(role);
  let found = false;
  const out = grants.map((g) => {
    if (normalizeUserId(g.userId) === uid) {
      found = true;
      return { userId: uid, role: nextRole };
    }
    return { userId: normalizeUserId(g.userId), role: g.role };
  });
  if (!found) out.push({ userId: uid, role: nextRole });
  return out;
}

/** Remove a user's grant. Returns a NEW list. PURE. */
export function removeGrant(grants: readonly AppGrant[], userId: unknown): AppGrant[] {
  const uid = normalizeUserId(userId);
  return grants
    .filter((g) => normalizeUserId(g.userId) !== uid)
    .map((g) => ({ userId: normalizeUserId(g.userId), role: g.role }));
}

/** The app-role a user holds via an explicit grant, or null if they hold none. PURE. */
export function grantRoleForUser(grants: readonly AppGrant[], userId: string): AppShareRole | null {
  const uid = normalizeUserId(userId);
  for (const g of grants) {
    if (normalizeUserId(g.userId) === uid) return g.role;
  }
  return null;
}

/** Sanitise an untrusted grants array (drop malformed / empty-user entries; dedupe by user). PURE. */
export function sanitizeGrants(raw: unknown): AppGrant[] {
  if (!Array.isArray(raw)) return [];
  let out: AppGrant[] = [];
  for (const g of raw) {
    const o = (g ?? {}) as Record<string, unknown>;
    out = upsertGrant(out, o.userId, o.role);
  }
  return out;
}

// ─── the upward management chain (org-chart resolution) ──────────────────────────────────────────────
// The org-chart is departments → teams → members, where a team member is a `lead` or a `member`
// (teams-policy.ts). We derive a reporting line from this: a person's MANAGER is the `lead` of a team
// they belong to. Climbing: creator → the lead(s) of the creator's team(s) → those leads' own team
// leads → … up to the top. This is the "upward hierarchy" the brief specifies — resolved from the
// existing org-chart, not a new manager field.
//
// The DEFAULT inherited app-role for the management chain is `approver`: a manager up the chain can
// VIEW, RUN, TRIGGER, and APPROVE what their reports create (oversight + sign-off authority), but NOT
// EDIT it — editing another person's app stays with the owner, explicit `editor` grants, and admins.
export const HIERARCHY_INHERITED_ROLE: AppShareRole = 'approver';

// The org-chart slice the resolver needs — kept to the pure Membership shape (no DB types leaked).
export interface OrgChartMembership {
  teamId: string;
  userId: string;
  role: 'lead' | 'member';
}

/**
 * Resolve the creator's UPWARD management chain from the org-chart. PURE — no IO.
 *
 * A user's managers are the `lead`s of every team they belong to (excluding themselves). We climb
 * transitively: start from the creator, collect the leads of their teams, then the leads of THOSE
 * people's teams, and so on. Cycles (A leads B's team, B leads A's team) and the creator's own id are
 * guarded against — every id is visited once. Returns the chain as a deduped, normalised id list in
 * breadth-first (nearest-manager-first) order; the creator is NEVER included.
 *
 * `memberships` is the FULL org membership list (all teams). A team `lead` is a manager to that team's
 * members; a lead is NOT their own manager, and a lead's own managers come from OTHER teams they
 * belong to (climbing the chart).
 */
export function resolveManagementChain(
  creatorId: string,
  memberships: readonly OrgChartMembership[],
): string[] {
  const creator = normalizeUserId(creatorId);
  if (!creator) return [];

  // Index: for a given user, which teams are they in; and per team, who are its leads.
  const teamsOfUser = new Map<string, Set<string>>();
  const leadsOfTeam = new Map<string, Set<string>>();
  for (const m of memberships) {
    const uid = normalizeUserId(m.userId);
    if (!uid) continue;
    if (!teamsOfUser.has(uid)) teamsOfUser.set(uid, new Set());
    teamsOfUser.get(uid)!.add(m.teamId);
    if (m.role === 'lead') {
      if (!leadsOfTeam.has(m.teamId)) leadsOfTeam.set(m.teamId, new Set());
      leadsOfTeam.get(m.teamId)!.add(uid);
    }
  }

  // BFS up the chart. `chain` preserves discovery order; `seen` guards cycles + the creator.
  const chain: string[] = [];
  const seen = new Set<string>([creator]);
  let frontier = [creator];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const person of frontier) {
      for (const teamId of teamsOfUser.get(person) ?? []) {
        for (const lead of leadsOfTeam.get(teamId) ?? []) {
          if (lead === person) continue; // a lead is not their own manager
          if (seen.has(lead)) continue;
          seen.add(lead);
          chain.push(lead);
          next.push(lead);
        }
      }
    }
    frontier = next;
  }
  return chain;
}

/** Is the caller somewhere in the creator's upward management chain? PURE. */
export function isInManagementChain(
  callerId: string,
  creatorId: string,
  memberships: readonly OrgChartMembership[],
): boolean {
  const uid = normalizeUserId(callerId);
  if (!uid) return false;
  return resolveManagementChain(creatorId, memberships).includes(uid);
}

// ─── the composed SHARE decision ─────────────────────────────────────────────────────────────────────
export interface ShareAccessInput {
  /** The acting caller's id (email/username). */
  callerId: string;
  /** The app's owner/creator id (grants + the hierarchy are resolved relative to THIS user). */
  creatorId: string;
  /** The action being attempted. */
  action: AppAction;
  /** Explicit per-app grants. */
  grants: readonly AppGrant[];
  /** The full org membership list (for the upward-hierarchy resolution). */
  memberships: readonly OrgChartMembership[];
}

export interface ShareDecision {
  allow: boolean;
  /** How the caller was admitted — for the audit/reason string. */
  via: 'grant' | 'hierarchy' | 'none';
  reason: string;
}

/**
 * Decide whether the sharing layer admits the caller for the action. PURE. Additive to RBAC/ABAC:
 *   • an explicit grant whose app-role permits the action  → allow (via 'grant');
 *   • else the caller is in the creator's management chain AND the inherited role permits the action
 *     → allow (via 'hierarchy');
 *   • else no share-path admits them (via 'none') — the RBAC/ABAC layer decides on its own.
 * The caller being the owner/admin is handled by evaluateAppAccess; this layer purely ADDS the
 * grant + hierarchy paths, so a 'none' here is not a denial — it just means "no share grant".
 */
export function evaluateShareAccess(input: ShareAccessInput): ShareDecision {
  const grantRole = grantRoleForUser(input.grants, input.callerId);
  if (grantRole && shareRolePermits(grantRole, input.action)) {
    return {
      allow: true,
      via: 'grant',
      reason: `granted app-role ${grantRole} permits ${input.action}`,
    };
  }

  if (
    isInManagementChain(input.callerId, input.creatorId, input.memberships) &&
    shareRolePermits(HIERARCHY_INHERITED_ROLE, input.action)
  ) {
    return {
      allow: true,
      via: 'hierarchy',
      reason: `caller is in the creator's management chain (inherits ${HIERARCHY_INHERITED_ROLE}) — permits ${input.action}`,
    };
  }

  return { allow: false, via: 'none', reason: 'no explicit grant or management-chain inheritance' };
}
