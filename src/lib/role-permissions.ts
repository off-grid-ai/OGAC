import {
  baselineModules,
  BUILTIN_ROLES,
  type EffectivePermissions,
  allModuleIds,
} from '@/lib/roles';
import { getCustomRoleByName } from '@/lib/store';
import { type ModuleId } from '@/modules/registry';

// Server-side role→permission resolution. Kept in its OWN leaf module (no `next/navigation`, no
// `@/auth`) so DB-backed libs that only need role resolution — e.g. org-knowledge's permission-aware
// retrieval — can depend on it without dragging in Next's request/navigation surface (which is not
// resolvable outside the Next bundler and would make those libs untestable). The user-aware guard
// (`requireModuleForUser`, which DOES need auth + notFound) stays in lib/module-access, which
// re-exports these so existing importers are unchanged.

// Resolve a session role string into effective permissions. Built-in roles pass through with full
// module access. A custom role resolves to its `based_on` baseline UNIONed with its granted
// `capabilities` (module ids), so granting a custom role module access takes effect.
export async function resolveEffectivePermissions(
  role: string | undefined,
): Promise<EffectivePermissions> {
  const r = role ?? 'viewer';
  if ((BUILTIN_ROLES as readonly string[]).includes(r) || r === 'compliance') {
    return { role: r, baseRole: r, isCustom: false, modules: new Set(allModuleIds()) };
  }
  const custom = await getCustomRoleByName(r);
  if (!custom) {
    // Unknown role → fail closed to a viewer baseline (no admin plane).
    return { role: r, baseRole: 'viewer', isCustom: false, modules: baselineModules('viewer') };
  }
  const modules = baselineModules(custom.basedOn);
  const known = new Set<string>(allModuleIds());
  for (const cap of custom.capabilities) {
    if (known.has(cap)) modules.add(cap as ModuleId);
  }
  return { role: r, baseRole: custom.basedOn, isCustom: true, modules };
}

// The built-in role whose ABAC/capability rules apply to this session — custom roles inherit their
// `based_on`. Used by the RBAC/ABAC gates so a custom role is governed by its base role's rules.
export async function effectiveBaseRole(role: string | undefined): Promise<string> {
  return (await resolveEffectivePermissions(role)).baseRole;
}
