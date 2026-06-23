// RBAC roles for the console (the user/admin surface). Device-side auth is separate.
export const RBAC_ROLES = ['admin', 'compliance', 'viewer'] as const;

export type RbacRole = (typeof RBAC_ROLES)[number];

export function isRbacRole(value: unknown): value is RbacRole {
  return typeof value === 'string' && (RBAC_ROLES as readonly string[]).includes(value);
}
