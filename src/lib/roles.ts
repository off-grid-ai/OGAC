import { MODULES, type ModuleId } from '@/modules/registry';

// RBAC roles for the console (the user/admin surface). Device-side auth is separate.
export const RBAC_ROLES = ['admin', 'compliance', 'viewer'] as const;

export type RbacRole = (typeof RBAC_ROLES)[number];

export function isRbacRole(value: unknown): value is RbacRole {
  return typeof value === 'string' && (RBAC_ROLES as readonly string[]).includes(value);
}

// The built-in roles a custom role may inherit from (matches the roles admin API validation).
export const BUILTIN_ROLES = ['viewer', 'operator', 'admin'] as const;

export function allModuleIds(): ModuleId[] {
  return MODULES.map((m) => m.id);
}

// Baseline module access for each built-in role. Built-in role sessions keep their historic
// behavior — full access to every enabled module — so nothing regresses. These baselines are only
// consulted to seed a *custom* role's inherited access via its `based_on`. Pure (no DB) so this
// stays client-safe.
export function baselineModules(builtIn: string): Set<ModuleId> {
  if (builtIn === 'admin' || builtIn === 'operator') return new Set(allModuleIds());
  // viewer (and any unknown base) — read surfaces only; excludes the admin control plane.
  return new Set(allModuleIds().filter((id) => id !== 'admin'));
}

// A user's effective, runtime-resolved permissions. `baseRole` is the built-in role whose ABAC
// rules apply (custom roles inherit their `based_on`); `modules` is the set of module ids the user
// may reach. `isCustom` distinguishes a custom-role session from a built-in one.
export interface EffectivePermissions {
  role: string;
  baseRole: string;
  isCustom: boolean;
  modules: Set<ModuleId>;
}
