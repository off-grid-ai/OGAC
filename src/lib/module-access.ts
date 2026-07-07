import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isModuleEnabled } from '@/lib/modules';
import { type ModuleId } from '@/modules/registry';
// Role→permission resolution lives in a leaf module (no auth/navigation imports) so DB-backed libs
// can depend on it without dragging in Next's request surface. Re-exported here so every existing
// `@/lib/module-access` importer of these is unchanged.
import { effectiveBaseRole, resolveEffectivePermissions } from '@/lib/role-permissions';
export { effectiveBaseRole, resolveEffectivePermissions };

// Server-only, user-aware permission resolution. Kept out of lib/roles (which is client-safe and
// imported by client components) and lib/modules (env-only) because this reaches the DB for custom
// -role resolution and must never enter a client bundle.

// User-aware module guard. Reachable only when BOTH the deployment enabled the module AND the
// signed-in user's role grants access. Denied → 404 (same as a disabled module — don't reveal it).
export async function requireModuleForUser(id: ModuleId): Promise<void> {
  if (!isModuleEnabled(id)) notFound();
  const session = await auth();
  const eff = await resolveEffectivePermissions(session?.user?.role);
  if (!eff.modules.has(id)) notFound();
}
