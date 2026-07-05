// Pure, zero-IO mapping: a machine (service-account) principal's Keycloak realm roles → the
// console capability it is authorized for. No network, no DB — deterministic and unit-testable
// with the real functions (no mocks).
//
// WHY THIS EXISTS: human sessions carry a built-in console role (admin/compliance/viewer) resolved
// from the login flow. A machine client_credentials token instead carries realm roles like
// `svc-gateway` (the service scope) and, when granted, a dedicated console-capability role. The
// console's authz gates reason in terms of a single `role` string ('admin' | ...); this module is
// the single place that decides which machine realm roles elevate a service account to a console
// capability — kept LEAST-PRIVILEGE: only an explicit grant role elevates, a bare `svc-*` scope
// role does NOT. Adding `svc-gateway` to a client never, by itself, grants console admin.

// The dedicated realm role that grants a machine principal the console **admin** capability.
// A service account must be explicitly assigned this role to reach admin-gated routes; the
// per-service `svc-<service>` scope role alone never does. Provisioned onto the integration-bus
// (gateway) client's service account so the console's own machine caller is authorized, and
// declared in the realm seed so a fresh import is correct.
export const CONSOLE_ADMIN_ROLE = 'console-admin';

// Resolve a machine principal's realm roles to the console role string the authz gates use.
// Returns 'admin' only when the explicit CONSOLE_ADMIN_ROLE grant is present. Otherwise returns
// the token's already-resolved scope role unchanged (e.g. 'svc-gateway'), so a service account with
// only a scope role keeps exactly the (non-admin) authority it had — no blanket elevation.
export function machineConsoleRole(realmRoles: readonly string[], resolvedRole: string): string {
  if (realmRoles.includes(CONSOLE_ADMIN_ROLE)) return 'admin';
  return resolvedRole;
}
