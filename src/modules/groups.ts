import type { ModuleId } from './registry';

// Nav grouping for the sidebar — turns the flat ~30-module list into scannable sections.
// Single source of truth for which section a module lives in + the section order. Any enabled
// module NOT listed here falls into the trailing "More" group, so nothing ever disappears.
export interface NavGroup {
  id: string;
  label: string;
  modules: ModuleId[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'Home',
    modules: ['overview'],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    modules: ['chat', 'projects', 'artifacts', 'prompts', 'knowledge', 'storage', 'studio'],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    modules: ['agents', 'agent-runs', 'brain', 'evals', 'sandbox', 'provit'],
  },
  {
    id: 'gateway',
    label: 'Gateway & Fleet',
    modules: ['services', 'gateway', 'fleet'],
  },
  {
    id: 'data',
    label: 'Data',
    modules: ['data', 'retrieval', 'integrations', 'lineage'],
  },
  {
    id: 'governance',
    label: 'Governance',
    modules: ['control', 'policy', 'access', 'guardrails', 'secrets', 'regulatory', 'provenance'],
  },
  {
    id: 'insights',
    label: 'Insights',
    modules: ['observability', 'analytics', 'drift', 'finops', 'reports', 'siem'],
  },
  {
    id: 'operations',
    label: 'Operations',
    modules: ['backups', 'api-docs', 'config', 'admin'],
  },
];

// Group a list of enabled modules into ordered sections. Modules not assigned to any group are
// collected into a trailing "More" section so the nav can never silently drop a module.
export function groupModules<T extends { id: ModuleId }>(
  modules: T[],
): { label: string; items: T[] }[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const claimed = new Set<ModuleId>();
  const sections: { label: string; items: T[] }[] = [];

  for (const g of NAV_GROUPS) {
    const items: T[] = [];
    for (const id of g.modules) {
      const m = byId.get(id);
      if (m) {
        items.push(m);
        claimed.add(id);
      }
    }
    if (items.length) sections.push({ label: g.label, items });
  }

  const leftovers = modules.filter((m) => !claimed.has(m.id));
  if (leftovers.length) sections.push({ label: 'More', items: leftovers });

  return sections;
}
