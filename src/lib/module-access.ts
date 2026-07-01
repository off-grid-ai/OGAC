import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isModuleEnabled } from '@/lib/modules';
import {
  baselineModules,
  BUILTIN_ROLES,
  type EffectivePermissions,
  allModuleIds,
} from '@/lib/roles';
import { getCustomRoleByName } from '@/lib/store';
import { type ModuleId } from '@/modules/registry';

// Server-only, user-aware permission resolution. Kept out of lib/roles (which is client-safe and
// imported by client components) and lib/modules (env-only) because this reaches the DB for custom
// -role resolution and must never enter a client bundle.

// Resolve a session role string into effective permissions. Built-in roles pass through with full
// module access (unchanged behavior). A custom role resolves to its `based_on` baseline UNIONed with
// its granted `capabilities` (module ids), so granting a custom role module access takes effect.
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

// User-aware module guard. Reachable only when BOTH the deployment enabled the module AND the
// signed-in user's role grants access. Denied → 404 (same as a disabled module — don't reveal it).
export async function requireModuleForUser(id: ModuleId): Promise<void> {
  if (!isModuleEnabled(id)) notFound();
  const session = await auth();
  const eff = await resolveEffectivePermissions(session?.user?.role);
  if (!eff.modules.has(id)) notFound();
}
