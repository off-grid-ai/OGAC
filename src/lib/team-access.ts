// PURE team-scoped ACCESS rule — ZERO imports of db/IO, exhaustively unit-testable. This is the ONE
// rule that answers "can THIS user act on THIS team-governed entity via their team membership + role?"
// — reused by BOTH pipelines AND apps/agents, so a role check is never re-hardcoded in a route/UI.
//
// DRY / SOLID: the membership → role RESOLUTION already lives in teams-policy.resolveLifecycleRole
// (admin ∪ approver ∪ owner ∪ team-membership → LifecycleRole). This module does NOT duplicate it — it
// REUSES it, and adds the one genuinely-new piece apps need: a mapping from that resolved role to the
// concrete ACTIONS a member may take on a governed entity (view/run/trigger/edit/approve/delete). The
// entity shape is generic (`{ ownerId, teamId }`) so a pipeline and an app are governed identically.
import { type LifecycleRole, roleAtLeast } from '@/lib/pipeline-lifecycle-model';
import {
  type ActorContext,
  type Membership,
  type PipelineOwnership,
  resolveLifecycleRole,
} from '@/lib/teams-policy';

// A team-governed entity is anything with an owner + an optional governing team — a pipeline OR an
// app/agent. Aliased to the existing ownership shape so there is exactly one definition.
export type TeamGovernedEntity = PipelineOwnership;

// The actions a team member can take on a team-governed entity. Mirrors the app-access AppAction
// vocabulary (run/view/edit/approve/trigger) plus `delete` (owner/admin-grade destructive action).
export type TeamEntityAction = 'view' | 'run' | 'trigger' | 'edit' | 'approve' | 'delete';

export const TEAM_ENTITY_ACTIONS: readonly TeamEntityAction[] = [
  'view',
  'run',
  'trigger',
  'edit',
  'approve',
  'delete',
];

/** True iff `v` names a valid team-entity action. PURE. */
export function isTeamEntityAction(v: unknown): v is TeamEntityAction {
  return typeof v === 'string' && (TEAM_ENTITY_ACTIONS as readonly string[]).includes(v);
}

// The MINIMUM delegated LifecycleRole required for each action, on the role ladder
// none < member < editor < approver < admin:
//   • view / run     → member  (a `member`-role teammate can read + execute the team's entities)
//   • trigger / edit → editor  (a `lead`-role teammate can wire triggers + change the spec)
//   • approve        → approver (sign-off authority — a designated approver / org admin)
//   • delete         → admin   (destructive — org admin only; owners handle their own via ownership)
const ACTION_MIN_ROLE: Record<TeamEntityAction, LifecycleRole> = {
  view: 'member',
  run: 'member',
  trigger: 'editor',
  edit: 'editor',
  approve: 'approver',
  delete: 'admin',
};

/** The minimum delegated role an action requires. PURE. */
export function minRoleForAction(action: TeamEntityAction): LifecycleRole {
  return ACTION_MIN_ROLE[action];
}

/**
 * PURE: does a resolved delegated LifecycleRole grant a given action on a team-governed entity?
 * `none` grants nothing; every other role grants an action iff it is at least the action's minimum on
 * the ladder. This is the single source of truth for "role → capability" on team-governed entities.
 */
export function teamRoleGrantsAction(role: LifecycleRole, action: TeamEntityAction): boolean {
  if (role === 'none') return false;
  return roleAtLeast(role, ACTION_MIN_ROLE[action]);
}

/**
 * PURE: resolve the actor's effective LifecycleRole on a team-governed entity. Thin re-export of the
 * central resolver (teams-policy.resolveLifecycleRole) under an entity-agnostic name so callers scoping
 * an app read the same rule as callers scoping a pipeline — never a second, divergent resolver.
 */
export function resolveTeamEntityRole(
  actor: ActorContext,
  entity: TeamGovernedEntity,
  memberships: Membership[],
): LifecycleRole {
  return resolveLifecycleRole(actor, entity, memberships);
}

export interface TeamAccessDecision {
  allow: boolean;
  /** The actor's resolved role on the entity (for display / audit / debugging). */
  role: LifecycleRole;
  reason: string;
}

/**
 * PURE: the COMPOSED decision — can this actor take `action` on this team-governed entity via their
 * team membership + role? Resolves the role once (admin ∪ approver ∪ owner ∪ team membership), then
 * applies the role→capability mapping. The ONE call every surface (route, UI, enforcement seam) uses
 * to scope a team-governed entity — no duplicated role arithmetic anywhere else.
 */
export function canActOnTeamEntity(
  actor: ActorContext,
  entity: TeamGovernedEntity,
  memberships: Membership[],
  action: TeamEntityAction,
): TeamAccessDecision {
  const role = resolveTeamEntityRole(actor, entity, memberships);
  const allow = teamRoleGrantsAction(role, action);
  if (allow) {
    return { allow: true, role, reason: `${action} permitted (role ${role})` };
  }
  const need = ACTION_MIN_ROLE[action];
  const why =
    role === 'none'
      ? 'no team access to this entity'
      : `role ${role} is below the ${need} required to ${action}`;
  return { allow: false, role, reason: why };
}
