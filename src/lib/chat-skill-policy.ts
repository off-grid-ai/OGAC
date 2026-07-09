// Pure skill-visibility RULE (zero imports, zero I/O → unit-testable with no mocks). Given a skill's
// visibility/enabled/role fields and the requesting actor (role + id), decide whether the skill is
// visible to that actor. TENANT scoping (org_id) is applied SEPARATELY at the query layer in
// chat.ts (listSkills filters by orgId before this runs) — this rule governs role/ownership only,
// so both concerns stay isolated and independently testable.

export interface SkillVisibilityFields {
  visibility?: string | null;
  enabled?: boolean | null;
  allowedRoles?: string[] | null;
  createdBy?: string | null;
}

// Visible when: the actor is an admin (sees all within their org); OR the skill is enabled, is not a
// private assistant belonging to someone else, and either has no role restriction or lists the
// actor's role.
export function skillVisibleTo(
  s: SkillVisibilityFields,
  role: string,
  userId?: string,
): boolean {
  if (role === 'admin') return true;
  // Private assistants are visible only to their creator.
  if (s.visibility === 'private' && s.createdBy !== userId) return false;
  return Boolean(s.enabled) && (!s.allowedRoles?.length || s.allowedRoles.includes(role));
}
