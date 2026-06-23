import { notFound } from 'next/navigation';
import { MODULES, type ModuleDef, type ModuleId } from '@/modules/registry';

// Modules enabled for this deployment. Env-driven so a customer runs only what they bought.
// Empty/unset => every module enabled (dev default).
function enabledIds(): ReadonlySet<ModuleId> {
  const raw = process.env.NEXT_PUBLIC_OFFGRID_MODULES?.trim();
  if (!raw) return new Set(MODULES.map((m) => m.id));
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as ModuleId[];
  return new Set(ids);
}

export function getEnabledModules(): ModuleDef[] {
  const allowed = enabledIds();
  return MODULES.filter((m) => allowed.has(m.id));
}

export function isModuleEnabled(id: ModuleId): boolean {
  return enabledIds().has(id);
}

// Guard a module's page/route: a deployment without this module returns 404.
export function requireModule(id: ModuleId): void {
  if (!isModuleEnabled(id)) notFound();
}
