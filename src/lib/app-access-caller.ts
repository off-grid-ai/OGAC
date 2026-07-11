// ─── Caller resolution for per-app access enforcement (thin I/O; DRY across entry points) ──────────
//
// Every enforced entry point (run / agent-run / webhook-trigger / HITL-approve) builds the SAME
// AppAccessCaller before calling enforceAppAccess. Extracting it here keeps the routes thin and the
// identity→caller mapping in ONE place (no copy-paste that could drift). Two flavours:
//   • callerFromSession — an interactive/bearer principal (AuthzSession from requireAdmin/requireUser)
//   • callerFromMachine — a machine principal (a webhook trigger's Actor), no session/role
//
// Role is resolved to the EFFECTIVE BASE role (custom roles inherit their base) so a custom role is
// governed by its base's access. Department is best-effort from the actor's team memberships (null
// when unknown) — the pure decision treats a null department as "no department grant".

import { type AppAccessCaller } from '@/lib/app-access-policy';
import { type Actor } from '@/lib/audit-event';
import { type AuthzSession } from '@/lib/authz';
import { effectiveBaseRole } from '@/lib/role-permissions';
import { listMembershipsForUser } from '@/lib/teams';

// Best-effort department for a user: the department of the first team they belong to that HAS one.
// Never throws — an absent/failed lookup yields null (the decision then relies on role/owner/admin).
async function departmentForUser(userId: string, orgId: string): Promise<string | null> {
  try {
    const memberships = await listMembershipsForUser(userId, orgId);
    for (const m of memberships) {
      const { getTeam } = await import('@/lib/teams');
      const team = await getTeam(m.teamId, orgId);
      if (team?.department) return team.department;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

// Build the caller from an already-gated session (the shape requireAdmin/requireUser return).
export async function callerFromSession(
  gate: AuthzSession,
  orgId: string,
): Promise<AppAccessCaller> {
  const userId = gate.user.email ?? 'unknown';
  const role = await effectiveBaseRole(gate.user.role);
  const department = await departmentForUser(userId, orgId);
  return { role, department, orgId, userId };
}

// Build the caller from a MACHINE actor (webhook/schedule). No interactive role — a machine trigger
// is treated as a `machine` role (never an admin/owner), so it is governed purely by the consumer's
// explicit `trigger`-action allow-list. This is deliberately least-privilege: a token can fire a
// consumer only if the policy explicitly admits the `machine` role (or `*`) for `trigger`.
export function callerFromMachine(actor: Actor, orgId: string): AppAccessCaller {
  return { role: 'machine', department: null, orgId, userId: actor.id };
}
