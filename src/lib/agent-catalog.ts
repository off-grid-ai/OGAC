// Pure ownership projection for the Agents surface.
// User-authored agents are single-step AppSpecs. Custom runtime rows are execution details and are
// therefore excluded; built-ins remain reusable capabilities with their existing runtime detail.

import { filterSingleStepApps, type AppSpec } from '@/lib/app-model';
import type { AgentDef } from '@/lib/agents';

export interface CanonicalAgentCatalog {
  builtIns: AgentDef[];
  authored: AppSpec[];
}

export function canonicalAgentCatalog(
  managedAgents: readonly AgentDef[],
  apps: AppSpec[],
): CanonicalAgentCatalog {
  return {
    builtIns: managedAgents.filter((agent) => !agent.custom),
    authored: filterSingleStepApps(apps),
  };
}
