import type { ModuleId } from './registry';

export type IaSectionId =
  'home' | 'work' | 'solutions' | 'data' | 'runtime' | 'governance' | 'insights' | 'operations';

export type CanonicalOwnerId =
  | 'overview'
  | 'chat'
  | 'projects'
  | 'prompts'
  | 'artifacts'
  | 'files'
  | 'apps'
  | 'agents'
  | 'reviews'
  | 'tools'
  | 'quality-definitions'
  | 'sources'
  | 'domains'
  | 'data-flows'
  | 'warehouse'
  | 'catalog'
  | 'knowledge'
  | 'lineage'
  | 'models'
  | 'gateways'
  | 'runtime-pipelines'
  | 'api-budgets'
  | 'posture'
  | 'policies'
  | 'access'
  | 'teams'
  | 'guardrails'
  | 'secrets'
  | 'evidence'
  | 'trust'
  | 'outcomes'
  | 'ai-behavior'
  | 'usage'
  | 'quality-results'
  | 'cost'
  | 'runs'
  | 'nodes'
  | 'clusters'
  | 'services'
  | 'platform-health'
  | 'edge'
  | 'managed-devices'
  | 'configuration'
  | 'backups'
  | 'admin';

export interface IaSection {
  id: IaSectionId;
  label: string;
  purpose: string;
  ownershipRule: string;
}

export interface CanonicalOwner {
  id: CanonicalOwnerId;
  section: IaSectionId;
  label: string;
  description: string;
  route: string;
  /** Existing commercial capability gate. IA does not create a parallel entitlement system. */
  gate: ModuleId;
  /** Where this collection is discovered. Contextual owners live inside their declared parent. */
  placement: 'sidebar' | 'contextual';
  /**
   * Sidebar collection that owns a contextual resource. Required when placement is contextual.
   * This keeps relationship resources (for example clusters under physical topology) inside their
   * real journey instead of creating another global sibling.
   */
  sidebarParent?: CanonicalOwnerId;
  comingSoon?: boolean;
}

export const IA_SECTIONS: readonly IaSection[] = [
  {
    id: 'home',
    label: 'Home',
    purpose: 'See what needs attention and where to go next.',
    ownershipRule: 'Owns summaries and shortcuts, never canonical entities.',
  },
  {
    id: 'work',
    label: 'Work',
    purpose: 'Use Off Grid AI without needing platform knowledge.',
    ownershipRule: 'Owns human work objects; enterprise knowledge belongs to Data.',
  },
  {
    id: 'solutions',
    label: 'Solutions',
    purpose: 'Build and operate high-value business use cases.',
    ownershipRule:
      'Blueprints prove reusable value; Apps own tenant deployments; built-in Agents are reusable App components, not a parallel registry.',
  },
  {
    id: 'data',
    label: 'Data',
    purpose: 'Turn enterprise systems into governed solution context.',
    ownershipRule: 'Owns enterprise data resources, not vendor engines.',
  },
  {
    id: 'runtime',
    label: 'AI Runtime',
    purpose: 'Control available AI capabilities and governed access.',
    ownershipRule:
      'Owns logical models and access contracts; physical machines belong to Operations.',
  },
  {
    id: 'governance',
    label: 'Governance',
    purpose: 'Define, enforce, and prove controls.',
    ownershipRule: 'Global rules and evidence live here; apps and pipelines show assignments.',
  },
  {
    id: 'insights',
    label: 'Insights',
    purpose: 'Measure effectiveness, reliability, adoption, and economics.',
    ownershipRule: 'Owns measured results, not configuration or service health.',
  },
  {
    id: 'operations',
    label: 'Operations',
    purpose: 'Run the execution plane, fleet, services, and recovery controls.',
    ownershipRule: 'Owns runtime instances and infrastructure.',
  },
] as const;

export const CANONICAL_OWNERS: readonly CanonicalOwner[] = [
  {
    id: 'overview',
    section: 'home',
    label: 'Overview',
    description: 'Attention, value, active work, and platform posture.',
    route: '/overview',
    gate: 'overview',
    placement: 'sidebar',
  },

  {
    id: 'chat',
    section: 'work',
    label: 'Chat',
    description: 'Private conversations grounded in approved company context.',
    route: '/work/chat',
    gate: 'chat',
    placement: 'sidebar',
  },
  {
    id: 'projects',
    section: 'work',
    label: 'Projects',
    description: 'Shared instructions, conversations, apps, and activity.',
    route: '/work/projects',
    gate: 'projects',
    placement: 'sidebar',
  },
  {
    id: 'prompts',
    section: 'work',
    label: 'Prompts',
    description: 'Reusable prompts, versions, partials, and assignments.',
    route: '/work/prompts',
    gate: 'prompts',
    placement: 'sidebar',
  },
  {
    id: 'artifacts',
    section: 'work',
    label: 'Artifacts',
    description: 'Generated outputs, provenance, and shares.',
    route: '/work/artifacts',
    gate: 'artifacts',
    placement: 'sidebar',
  },
  {
    id: 'files',
    section: 'work',
    label: 'Files',
    description: 'On-prem files, folders, visibility, and sharing.',
    route: '/work/files',
    gate: 'storage',
    placement: 'sidebar',
  },

  {
    id: 'apps',
    section: 'solutions',
    label: 'Apps',
    description: 'Business use cases and agents across their full lifecycle.',
    route: '/solutions/apps',
    gate: 'studio',
    placement: 'sidebar',
  },
  {
    id: 'agents',
    section: 'solutions',
    label: 'Agents',
    description: 'Built-in AI capabilities available to run inside governed pipelines.',
    route: '/solutions/agents',
    gate: 'agents',
    placement: 'contextual',
    sidebarParent: 'apps',
  },
  {
    id: 'reviews',
    section: 'solutions',
    label: 'Reviews',
    description: 'Human approvals, exceptions, and decision history.',
    route: '/solutions/reviews',
    gate: 'studio',
    placement: 'sidebar',
  },
  {
    id: 'tools',
    section: 'solutions',
    label: 'Tools',
    description: 'HTTP, MCP, and built-in tools available to apps.',
    route: '/solutions/tools',
    gate: 'tools',
    placement: 'sidebar',
  },
  {
    id: 'quality-definitions',
    section: 'solutions',
    label: 'Quality',
    description: 'Evaluators, golden sets, and reusable quality gates.',
    route: '/solutions/quality',
    gate: 'evals',
    placement: 'sidebar',
  },

  {
    id: 'sources',
    section: 'data',
    label: 'Sources',
    description: 'Enterprise systems, connectors, credentials, and connection tests.',
    route: '/data/sources',
    gate: 'data',
    placement: 'sidebar',
  },
  {
    id: 'domains',
    section: 'data',
    label: 'Domains',
    description: 'Business terms, owners, source mappings, policies, and SLAs.',
    route: '/data/domains',
    gate: 'data-domains',
    placement: 'sidebar',
  },
  {
    id: 'data-flows',
    section: 'data',
    label: 'Flows',
    description: 'Replicated syncs and orchestrated data jobs.',
    route: '/data/flows',
    gate: 'data',
    placement: 'sidebar',
  },
  {
    id: 'warehouse',
    section: 'data',
    label: 'Warehouse',
    description: 'Tables, columns, queries, profiles, and freshness.',
    route: '/data/warehouse',
    gate: 'data',
    placement: 'sidebar',
  },
  {
    id: 'catalog',
    section: 'data',
    label: 'Catalog',
    description: 'Dataset ownership, classification, freshness, and impact.',
    route: '/data/catalog',
    gate: 'catalog',
    placement: 'sidebar',
  },
  {
    id: 'knowledge',
    section: 'data',
    label: 'Knowledge',
    description: 'Collections, documents, indexes, permissions, and app bindings.',
    route: '/data/knowledge',
    gate: 'knowledge',
    placement: 'sidebar',
  },
  {
    id: 'lineage',
    section: 'data',
    label: 'Lineage',
    description: 'Source-to-answer trace and impact analysis.',
    route: '/data/lineage',
    gate: 'lineage',
    placement: 'sidebar',
  },

  {
    id: 'models',
    section: 'runtime',
    label: 'Models',
    description: 'Logical model capabilities, versions, and availability.',
    route: '/runtime/models',
    gate: 'gateway',
    placement: 'sidebar',
  },
  {
    id: 'gateways',
    section: 'runtime',
    label: 'Gateways',
    description: 'Model endpoints, providers, egress class, and health.',
    route: '/runtime/gateways',
    gate: 'gateways',
    placement: 'sidebar',
  },
  {
    id: 'runtime-pipelines',
    section: 'runtime',
    label: 'Pipelines',
    description: 'Governed model-access and routing contracts.',
    route: '/runtime/pipelines',
    gate: 'pipelines',
    placement: 'sidebar',
  },
  {
    id: 'api-budgets',
    section: 'runtime',
    label: 'API & budgets',
    description: 'API keys, clients, rate limits, and budgets.',
    route: '/runtime/api-budgets',
    gate: 'finops',
    placement: 'sidebar',
  },

  {
    id: 'posture',
    section: 'governance',
    label: 'Posture',
    description: 'Control status, exceptions, risk, and emergency actions.',
    route: '/governance/posture',
    gate: 'control',
    placement: 'sidebar',
  },
  {
    id: 'policies',
    section: 'governance',
    label: 'Policies',
    description: 'Rules, versions, decisions, and assignments.',
    route: '/governance/policies',
    gate: 'policy',
    placement: 'sidebar',
  },
  {
    id: 'access',
    section: 'governance',
    label: 'Access',
    description: 'Users, roles, sessions, MFA, and service accounts.',
    route: '/governance/access',
    gate: 'access',
    placement: 'sidebar',
  },
  {
    id: 'teams',
    section: 'governance',
    label: 'Teams',
    description: 'Teams, membership, and delegated access.',
    route: '/governance/teams',
    gate: 'teams',
    placement: 'sidebar',
  },
  {
    id: 'guardrails',
    section: 'governance',
    label: 'Guardrails',
    description: 'Safety rules, recognizers, masking, thresholds, and tests.',
    route: '/governance/guardrails',
    gate: 'guardrails',
    placement: 'sidebar',
  },
  {
    id: 'secrets',
    section: 'governance',
    label: 'Secrets',
    description: 'Secrets, mounts, leases, seal state, and rotation.',
    route: '/governance/secrets',
    gate: 'secrets',
    placement: 'sidebar',
  },
  {
    id: 'evidence',
    section: 'governance',
    label: 'Evidence',
    description: 'Audit, security, provenance, and evidence exports.',
    route: '/governance/evidence',
    gate: 'audit',
    placement: 'sidebar',
  },
  {
    id: 'trust',
    section: 'governance',
    label: 'Trust & regulatory',
    description: 'Frameworks, controls, attestations, DPIAs, and reports.',
    route: '/governance/trust',
    gate: 'trust',
    placement: 'sidebar',
  },

  {
    id: 'outcomes',
    section: 'insights',
    label: 'Outcomes',
    description: 'Business KPIs, ROI, throughput, and effectiveness.',
    route: '/insights/outcomes',
    gate: 'roi',
    placement: 'sidebar',
  },
  {
    id: 'ai-behavior',
    section: 'insights',
    label: 'AI behavior',
    description: 'Traces, latency, errors, routing, and response behavior.',
    route: '/insights/ai',
    gate: 'observability',
    placement: 'sidebar',
  },
  {
    id: 'usage',
    section: 'insights',
    label: 'Usage',
    description: 'Requests, tokens, users, apps, and adoption.',
    route: '/insights/usage',
    gate: 'analytics',
    placement: 'sidebar',
  },
  {
    id: 'quality-results',
    section: 'insights',
    label: 'Quality',
    description: 'Eval results, drift, scorecards, and quality trends.',
    route: '/insights/quality',
    gate: 'drift',
    placement: 'sidebar',
  },
  {
    id: 'cost',
    section: 'insights',
    label: 'Cost',
    description: 'Spend, attribution, unit cost, budget consumption, and savings.',
    route: '/insights/cost',
    gate: 'accounting',
    placement: 'sidebar',
  },

  {
    id: 'runs',
    section: 'operations',
    label: 'Runs',
    description: 'Every app, agent, and chat execution with retry and cancel.',
    route: '/operations/runs',
    gate: 'runs',
    placement: 'sidebar',
  },
  {
    id: 'nodes',
    section: 'operations',
    label: 'Physical nodes',
    description: 'Registry-driven node inventory, roles, health, and capacity.',
    route: '/operations/nodes',
    gate: 'gateway',
    placement: 'sidebar',
  },
  {
    id: 'clusters',
    section: 'operations',
    label: 'Compute clusters',
    description: 'Registry-derived cluster head and member relationships.',
    route: '/operations/clusters',
    gate: 'gateway',
    placement: 'contextual',
    sidebarParent: 'nodes',
  },
  {
    id: 'services',
    section: 'operations',
    label: 'Services',
    description: 'Deployment-registry services, health, placement, and dependencies.',
    route: '/operations/services',
    gate: 'services',
    placement: 'sidebar',
  },
  {
    id: 'platform-health',
    section: 'operations',
    label: 'Platform health',
    description: 'Platform metrics, logs, traces, alerts, and queue health.',
    route: '/operations/health',
    gate: 'platform-health',
    placement: 'sidebar',
  },
  {
    id: 'edge',
    section: 'operations',
    label: 'Edge',
    description: 'Routes, tunnel, WAF, rate limits, and blocked traffic.',
    route: '/operations/edge',
    gate: 'edge',
    placement: 'sidebar',
  },
  {
    id: 'managed-devices',
    section: 'operations',
    label: 'Managed devices',
    description: 'Employee device enrollment, inventory, policy, and commands.',
    route: '/operations/devices',
    gate: 'fleet',
    placement: 'sidebar',
    comingSoon: true,
  },
  {
    id: 'configuration',
    section: 'operations',
    label: 'Configuration',
    description: 'Adapters, feature flags, auth, and environment references.',
    route: '/operations/configuration',
    gate: 'config',
    placement: 'sidebar',
  },
  {
    id: 'backups',
    section: 'operations',
    label: 'Backups',
    description: 'Backup jobs, schedules, restore, retention, and replication.',
    route: '/operations/backups',
    gate: 'backups',
    placement: 'sidebar',
  },
  {
    id: 'admin',
    section: 'operations',
    label: 'Admin',
    description: 'Tenants, organization settings, and platform administration.',
    route: '/operations/admin',
    gate: 'admin',
    placement: 'sidebar',
  },
] as const;

export function ownerById(id: CanonicalOwnerId): CanonicalOwner {
  const owner = CANONICAL_OWNERS.find((candidate) => candidate.id === id);
  if (!owner) throw new Error(`Unknown canonical owner: ${id}`);
  return owner;
}

export function ownerForPath(pathname: string): CanonicalOwner | undefined {
  return CANONICAL_OWNERS.filter(
    (owner) => pathname === owner.route || pathname.startsWith(`${owner.route}/`),
  ).sort((a, b) => b.route.length - a.route.length)[0];
}
