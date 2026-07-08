// PURE team / ownership RULES — ZERO imports of db/IO, exhaustively unit-testable (mirrors
// pipelines-policy.ts / pipeline-lifecycle-model.ts). M2 introduces a TEAM/BU tier between the org and
// the pipeline: a pipeline may belong to a team, and a team's members get DELEGATED access to their
// team's pipelines. This file owns — with no DB — the rules that decide:
//
//   1. validateTeamCreate / validateTeamUpdate — shape (name required, bounded).
//   2. team-member role vocabulary + validation (a member is a `lead` or a `member`).
//   3. teamAccessRole(membership) — map a membership role to the pipeline LifecycleRole it delegates.
//   4. resolveLifecycleRole(...) — the CENTRAL RBAC resolver: given an actor (email + org admin flag),
//      a pipeline (its ownerId + teamId), and the actor's team memberships, decide the actor's
//      LifecycleRole ON THAT PIPELINE (admin ∪ owner ∪ team membership). This is the seam the impure
//      layer feeds real rows into; the transition matrix in pipeline-lifecycle-model.ts consumes it.
//   5. validateOwnerReassign — owner-reassign input validation (non-empty, changed).
//
// The DB I/O lives in teams.ts (the adapter). This file can never touch the network or the DB.
import type { LifecycleRole } from '@/lib/pipeline-lifecycle-model';

// ─── team-member role vocabulary ────────────────────────────────────────────────────────────────────
// A membership is a `lead` (delegated EDIT + promote on the team's pipelines) or a `member`
// (delegated READ + deprecate). Approval + cross-team stays with org admins / designated approvers.
export type TeamMemberRole = 'lead' | 'member';

export const TEAM_MEMBER_ROLES: readonly TeamMemberRole[] = ['lead', 'member'];

export function isTeamMemberRole(v: unknown): v is TeamMemberRole {
  return typeof v === 'string' && (TEAM_MEMBER_ROLES as readonly string[]).includes(v);
}

/** Coerce an untrusted role value to a valid TeamMemberRole (defaults to the least-privileged). PURE. */
export function normalizeTeamMemberRole(v: unknown): TeamMemberRole {
  return isTeamMemberRole(v) ? v : 'member';
}

// ─── 1. team validation ──────────────────────────────────────────────────────────────────────────
export interface TeamCreateInput {
  name?: unknown;
  description?: unknown;
  /** Optional department this team belongs to (nullable ⇒ Unassigned). */
  department?: unknown;
}

export interface TeamValidation {
  ok: boolean;
  errors: string[];
}

export function validateTeamCreate(draft: TeamCreateInput): TeamValidation {
  const errors: string[] = [];
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (!name) errors.push('name is required');
  if (name.length > 120) errors.push('name must be 120 characters or fewer');
  if (draft.description !== undefined && typeof draft.description !== 'string') {
    errors.push('description must be a string');
  }
  errors.push(...validateDepartmentField(draft.department));
  return { ok: errors.length === 0, errors };
}

/** Same as create but name, if present, must still be non-empty. PURE. */
export function validateTeamUpdate(patch: TeamCreateInput): TeamValidation {
  const errors: string[] = [];
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name) errors.push('name cannot be empty');
    if (name.length > 120) errors.push('name must be 120 characters or fewer');
  }
  if (patch.description !== undefined && typeof patch.description !== 'string') {
    errors.push('description must be a string');
  }
  errors.push(...validateDepartmentField(patch.department));
  return { ok: errors.length === 0, errors };
}

// ─── department field ─────────────────────────────────────────────────────────────────────────────
// A team may belong to a DEPARTMENT (e.g. "Risk", "Operations", "Finance") — an optional grouping
// above the team so the Access surface reads as an org chart. Nullable + additive: a team with no
// department falls into the "Unassigned" bucket. PURE.

/** The bucket label for teams that have no department. */
export const UNASSIGNED_DEPARTMENT = 'Unassigned';

/** Validate an (optional) department value: null/undefined ⇒ ok; a string ⇒ bounded. PURE. */
function validateDepartmentField(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (typeof v !== 'string') return ['department must be a string'];
  if (v.trim().length > 120) return ['department must be 120 characters or fewer'];
  return [];
}

/**
 * Normalise a department value for STORAGE: trimmed; an empty/whitespace-only string collapses to
 * null (⇒ Unassigned). A non-string is null. PURE.
 */
export function normalizeDepartment(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** A team as the grouping helper sees it — id/name + its (possibly null) department. */
export interface TeamForGrouping {
  department: string | null;
}

/** A department group: a display label + the teams under it, in input order. */
export interface DepartmentGroup<T extends TeamForGrouping> {
  /** Display label — the department name, or "Unassigned" for the null bucket. */
  department: string;
  /** True iff this is the null / no-department bucket. */
  unassigned: boolean;
  teams: T[];
}

/**
 * Group teams by department into an ordered list of {department, teams} buckets. PURE — no IO.
 *   • teams with a (trimmed, non-empty) department group under that department;
 *   • teams with null / empty department fall into a single "Unassigned" bucket;
 *   • named departments are sorted case-insensitively; the "Unassigned" bucket, if present, is LAST;
 *   • team order WITHIN a bucket is preserved from the input (callers pre-sort, e.g. name asc).
 * This is the org-chart backbone for the Access "Teams & Departments" tab.
 */
export function groupTeamsByDepartment<T extends TeamForGrouping>(
  teamList: readonly T[],
): DepartmentGroup<T>[] {
  const named = new Map<string, T[]>();
  const unassigned: T[] = [];
  for (const t of teamList) {
    const dept = normalizeDepartment(t.department);
    if (dept === null) {
      unassigned.push(t);
    } else {
      const bucket = named.get(dept);
      if (bucket) bucket.push(t);
      else named.set(dept, [t]);
    }
  }
  const groups: DepartmentGroup<T>[] = [...named.entries()]
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([department, teams]) => ({ department, unassigned: false, teams }));
  if (unassigned.length > 0) {
    groups.push({ department: UNASSIGNED_DEPARTMENT, unassigned: true, teams: unassigned });
  }
  return groups;
}

/** The distinct, sorted list of department names currently in use (excludes the null bucket). PURE. */
export function distinctDepartments<T extends TeamForGrouping>(teamList: readonly T[]): string[] {
  const set = new Set<string>();
  for (const t of teamList) {
    const dept = normalizeDepartment(t.department);
    if (dept !== null) set.add(dept);
  }
  return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// ─── member validation ──────────────────────────────────────────────────────────────────────────────
export interface MemberInput {
  userId?: unknown;
  role?: unknown;
}

/** Validate an add-member request: a non-empty user id/email + a valid role. PURE. */
export function validateMember(draft: MemberInput): TeamValidation {
  const errors: string[] = [];
  const userId = typeof draft.userId === 'string' ? draft.userId.trim() : '';
  if (!userId) errors.push('userId (email) is required');
  if (userId.length > 320) errors.push('userId must be 320 characters or fewer');
  if (draft.role !== undefined && !isTeamMemberRole(draft.role)) {
    errors.push(`role must be one of ${TEAM_MEMBER_ROLES.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Normalise a user id/email for comparison: trimmed + lower-cased. PURE. */
export function normalizeUserId(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

// ─── a team membership as the pure layer sees it (no DB types leaked) ───────────────────────────────
export interface Membership {
  teamId: string;
  userId: string;
  role: TeamMemberRole;
}

// ─── 3. teamAccessRole — a membership → the pipeline LifecycleRole it delegates ──────────────────────
// A team `lead` gets delegated EDITOR on the team's pipelines (edit + promote); a `member` gets
// delegated MEMBER (read + deprecate). Neither can APPROVE — approval + cross-team is org-admin /
// designated-approver only, resolved separately.
export function teamAccessRole(role: TeamMemberRole): LifecycleRole {
  return role === 'lead' ? 'editor' : 'member';
}

// ─── 4. resolveLifecycleRole — the CENTRAL RBAC resolver ─────────────────────────────────────────────
export interface ActorContext {
  /** The actor's email/id (normalised inside). */
  email: string;
  /** True iff the actor is an ORG admin (cross-all authority). */
  isAdmin: boolean;
  /** True iff the actor is a designated APPROVER (may sign off a review → published). */
  isApprover?: boolean;
}

export interface PipelineOwnership {
  ownerId: string;
  /** The team this pipeline belongs to (null ⇒ no team; only owner/admin have access). */
  teamId: string | null;
}

/**
 * Resolve the actor's effective LifecycleRole ON a specific pipeline. PURE. The authority is the MAX of:
 *  - admin ⇒ 'admin' (cross-all — short-circuits);
 *  - approver flag ⇒ at least 'approver' (may sign off);
 *  - owner of the pipeline ⇒ at least 'editor';
 *  - a membership in the pipeline's team ⇒ teamAccessRole(that membership) ('editor' for a lead,
 *    'member' for a member);
 *  - otherwise 'none' (no access).
 * `memberships` is the actor's full membership list (any team); only the one matching the pipeline's
 * teamId contributes. The highest resolved role wins (roles are on the ordered ladder in the model).
 */
export function resolveLifecycleRole(
  actor: ActorContext,
  pipeline: PipelineOwnership,
  memberships: Membership[],
): LifecycleRole {
  if (actor.isAdmin) return 'admin';

  const ranks: Record<LifecycleRole, number> = {
    none: 0,
    member: 1,
    editor: 2,
    approver: 3,
    admin: 4,
  };
  let best: LifecycleRole = 'none';
  const bump = (r: LifecycleRole) => {
    if (ranks[r] > ranks[best]) best = r;
  };

  const me = normalizeUserId(actor.email);

  if (actor.isApprover) bump('approver');
  if (me && normalizeUserId(pipeline.ownerId) === me) bump('editor');

  if (pipeline.teamId) {
    for (const m of memberships) {
      if (m.teamId === pipeline.teamId && normalizeUserId(m.userId) === me) {
        bump(teamAccessRole(m.role));
      }
    }
  }

  return best;
}

/**
 * Does the actor have at least READ access to the pipeline? PURE — true when the resolved role is not
 * 'none'. The delegated-access CEILING: a team member can read/act on their team's pipelines, and a
 * non-member with no ownership + non-admin gets nothing (no cross-team leak).
 */
export function hasPipelineAccess(
  actor: ActorContext,
  pipeline: PipelineOwnership,
  memberships: Membership[],
): boolean {
  return resolveLifecycleRole(actor, pipeline, memberships) !== 'none';
}

// ─── 5. owner-reassign validation ────────────────────────────────────────────────────────────────────
export interface OwnerReassignInput {
  /** The current owner id/email. */
  currentOwnerId: string;
  /** The requested new owner id/email. */
  newOwnerId: unknown;
}

export interface OwnerReassignValidation {
  ok: boolean;
  /** The normalised (trimmed) new owner id, when valid. */
  ownerId: string;
  errors: string[];
}

/**
 * Validate an owner-reassign: the new owner must be a non-empty id/email and DIFFERENT from the
 * current owner (a no-op reassign is rejected so the audit trail stays meaningful). PURE.
 */
export function validateOwnerReassign(input: OwnerReassignInput): OwnerReassignValidation {
  const errors: string[] = [];
  const raw = typeof input.newOwnerId === 'string' ? input.newOwnerId.trim() : '';
  if (!raw) errors.push('newOwnerId is required');
  if (raw.length > 320) errors.push('newOwnerId must be 320 characters or fewer');
  if (raw && normalizeUserId(raw) === normalizeUserId(input.currentOwnerId)) {
    errors.push('new owner is the same as the current owner');
  }
  return { ok: errors.length === 0, ownerId: raw, errors };
}
