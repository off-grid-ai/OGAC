import type { CanonicalOwnerId } from './ownership';
import { LINEAGE_DESTINATIONS } from '../components/lineage/lineage-routes';
import { GUARDRAILS_DESTINATIONS } from '../lib/guardrails-destinations';
import { INSIGHTS_AI_DESTINATIONS, INSIGHTS_QUALITY_DESTINATIONS } from '../lib/insights-routes';
import {
  INSIGHTS_COST_DESTINATIONS,
  INSIGHTS_USAGE_DESTINATIONS,
} from '../lib/insights-usage-cost-routes';
import {
  CATALOG_DESTINATIONS,
  FLOW_DESTINATIONS,
  KNOWLEDGE_DESTINATIONS,
  WAREHOUSE_DESTINATIONS,
} from '../lib/data-destinations';
import {
  ADMIN_DESTINATIONS,
  CONFIGURATION_DESTINATIONS,
  EDGE_DESTINATIONS,
  HEALTH_DESTINATIONS,
  NODE_DESTINATIONS,
} from '../lib/operations-destinations';
import { API_BUDGET_DESTINATIONS, MODEL_DESTINATIONS } from './runtime-routes';

export type ContextualModuleId =
  | 'solutions-tools'
  | 'solutions-quality'
  | 'governance-policies'
  | 'governance-access'
  | 'governance-guardrails'
  | 'governance-secrets'
  | 'governance-evidence'
  | 'governance-trust'
  | 'data-lineage'
  | 'runtime-models'
  | 'runtime-api-budgets'
  | 'insights-ai'
  | 'insights-quality'
  | 'operations-health'
  | 'operations-configuration'
  | 'operations-edge'
  | 'operations-admin'
  | 'data-flows'
  | 'data-warehouse'
  | 'data-catalog'
  | 'data-knowledge'
  | 'insights-usage'
  | 'insights-cost'
  | 'operations-nodes';
export type ContextualDestinationId =
  | 'registered'
  | 'catalog'
  | 'primitives'
  | 'evaluators'
  | 'golden-cases'
  | 'executions'
  | 'performance'
  | 'release-gates'
  | 'runs'
  | 'overview'
  | 'rules'
  | 'templates'
  | 'modules'
  | 'decisions'
  | 'users'
  | 'invitations'
  | 'clients'
  | 'roles'
  | 'sessions'
  | 'mfa'
  | 'federation'
  | 'realm'
  | 'protections'
  | 'masking'
  | 'recognizers'
  | 'thresholds'
  | 'test'
  | 'keys'
  | 'dynamic-database'
  | 'leases'
  | 'mounts'
  | 'audit'
  | 'security'
  | 'provenance'
  | 'export'
  | 'regulatory'
  | 'reports'
  | 'graph'
  | 'datasets'
  | 'routing'
  | 'traffic'
  | 'logs'
  | 'fleet-control'
  | 'providers'
  | 'tuning'
  | 'budgets'
  | 'traces'
  | 'prompt-registry'
  | 'copilot'
  | 'scorecards'
  | 'drift'
  | 'metrics'
  | 'settings'
  | 'feature-flags'
  | 'adapters'
  | 'messaging'
  | 'waf'
  | 'blocked-requests'
  | 'organization'
  | 'tenants'
  | 'replication'
  | 'orchestration'
  | 'tables'
  | 'query'
  | 'assets'
  | 'governance'
  | 'collections'
  | 'indexes'
  | 'latency'
  | 'adoption'
  | 'dashboards'
  | 'projects'
  | 'models'
  | 'nodes'
  | 'clusters';

export interface ContextualDestination {
  id: ContextualDestinationId;
  label: string;
  description: string;
  route: string;
}

export interface ContextualModule {
  id: ContextualModuleId;
  ownerId: CanonicalOwnerId;
  label: string;
  description: string;
  baseRoute: string;
  /** The active module's destinations stay visible on desktop until the operator collapses them. */
  railDefaultOpen: boolean;
  /** Exact leaves keep nested entity-detail routes under their own lifecycle presentation. */
  destinationScope?: 'subtree' | 'exact';
  destinations: readonly ContextualDestination[];
}

/**
 * The canonical level-3 route tree for collection modules that contain several distinct places.
 *
 * Level 1 (Solutions) and level 2 (Tools / Quality) remain owned by `ownership.ts`. This registry
 * owns only their level-3 destinations, so the contextual rail, redirects, active-state policy,
 * tests, and any future command palette consumer read one route vocabulary.
 */
export const CONTEXTUAL_MODULES: readonly ContextualModule[] = [
  {
    id: 'solutions-tools',
    ownerId: 'tools',
    label: 'Tools',
    description: 'Register, discover, and inspect every tool an app can call.',
    baseRoute: '/solutions/tools',
    railDefaultOpen: true,
    destinations: [
      {
        id: 'registered',
        label: 'Registered',
        description: 'HTTP and MCP tools available to apps.',
        route: '/solutions/tools/registered',
      },
      {
        id: 'catalog',
        label: 'Catalog',
        description: 'Curated MCP servers you can add.',
        route: '/solutions/tools/catalog',
      },
      {
        id: 'primitives',
        label: 'Primitives',
        description: 'Built-in tools and their air-gap state.',
        route: '/solutions/tools/primitives',
      },
    ],
  },
  {
    id: 'solutions-quality',
    ownerId: 'quality-definitions',
    label: 'Quality',
    description: 'Define evaluators, maintain golden cases, and inspect quality runs.',
    baseRoute: '/solutions/quality',
    railDefaultOpen: true,
    destinations: [
      {
        id: 'evaluators',
        label: 'Evaluators',
        description: 'Reusable checks and evaluation definitions.',
        route: '/solutions/quality/evaluators',
      },
      {
        id: 'golden-cases',
        label: 'Golden cases',
        description: 'Expected inputs and outputs used as the quality bar.',
        route: '/solutions/quality/golden-cases',
      },
      {
        id: 'executions',
        label: 'Executions',
        description: 'Launch, re-run, and inspect individual evaluation executions.',
        route: '/solutions/quality/runs',
      },
      {
        id: 'drift',
        label: 'Drift',
        description: 'Compare deployed behavior with the active quality baseline.',
        route: '/solutions/quality/drift',
      },
      {
        id: 'performance',
        label: 'Performance',
        description: 'Inspect score trends, degradation, and operational quality.',
        route: '/solutions/quality/performance',
      },
      {
        id: 'release-gates',
        label: 'Release gates',
        description: 'Define the quality thresholds required before release.',
        route: '/solutions/quality/release-gates',
      },
    ],
  },
  {
    id: 'governance-policies',
    ownerId: 'policies',
    label: 'Policies',
    description: 'Define policy rules, reuse templates and modules, and inspect decisions.',
    baseRoute: '/governance/policies',
    railDefaultOpen: true,
    destinations: [
      {
        id: 'overview',
        label: 'Overview',
        description: 'Policy posture and actions.',
        route: '/governance/policies/overview',
      },
      {
        id: 'rules',
        label: 'Rules',
        description: 'Policy rules and assignments.',
        route: '/governance/policies/rules',
      },
      {
        id: 'templates',
        label: 'Templates',
        description: 'Reusable policy templates.',
        route: '/governance/policies/templates',
      },
      {
        id: 'modules',
        label: 'Modules',
        description: 'Policy modules and versions.',
        route: '/governance/policies/modules',
      },
      {
        id: 'decisions',
        label: 'Decisions',
        description: 'Policy decision history.',
        route: '/governance/policies/decisions',
      },
    ],
  },
  {
    id: 'governance-access',
    ownerId: 'access',
    label: 'Access',
    description: 'Manage people, machine identities, roles, sessions, and federation.',
    baseRoute: '/governance/access',
    railDefaultOpen: true,
    destinations: [
      {
        id: 'users',
        label: 'Users',
        description: 'People with console access.',
        route: '/governance/access/users',
      },
      {
        id: 'invitations',
        label: 'Invitations',
        description: 'Pending access invitations.',
        route: '/governance/access/invitations',
      },
      {
        id: 'clients',
        label: 'Machine clients',
        description: 'Service and machine identities.',
        route: '/governance/access/clients',
      },
      {
        id: 'roles',
        label: 'Roles',
        description: 'Role definitions and grants.',
        route: '/governance/access/roles',
      },
      {
        id: 'sessions',
        label: 'Sessions',
        description: 'Active user sessions.',
        route: '/governance/access/sessions',
      },
      {
        id: 'mfa',
        label: 'MFA',
        description: 'Multifactor authentication posture.',
        route: '/governance/access/mfa',
      },
      {
        id: 'federation',
        label: 'Federation',
        description: 'External identity providers.',
        route: '/governance/access/federation',
      },
      {
        id: 'realm',
        label: 'Realm',
        description: 'Identity realm configuration.',
        route: '/governance/access/realm',
      },
    ],
  },
  {
    id: 'governance-guardrails',
    ownerId: 'guardrails',
    label: 'Guardrails',
    description: 'Configure protections, masking, recognizers, thresholds, and tests.',
    baseRoute: '/governance/guardrails',
    railDefaultOpen: true,
    destinations: GUARDRAILS_DESTINATIONS,
  },
  {
    id: 'governance-secrets',
    ownerId: 'secrets',
    label: 'Secrets',
    description: 'Manage keys, dynamic credentials, leases, and mounts.',
    baseRoute: '/governance/secrets',
    railDefaultOpen: true,
    destinations: [
      {
        id: 'overview',
        label: 'Overview',
        description: 'Secret-store posture and actions.',
        route: '/governance/secrets/overview',
      },
      {
        id: 'keys',
        label: 'Keys',
        description: 'Stored secret keys.',
        route: '/governance/secrets/keys',
      },
      {
        id: 'dynamic-database',
        label: 'Dynamic database',
        description: 'Database credential roles.',
        route: '/governance/secrets/dynamic-database',
      },
      {
        id: 'leases',
        label: 'Leases',
        description: 'Issued secret leases.',
        route: '/governance/secrets/leases',
      },
      {
        id: 'mounts',
        label: 'Mounts',
        description: 'Secret engine mounts.',
        route: '/governance/secrets/mounts',
      },
    ],
  },
  {
    id: 'governance-evidence',
    ownerId: 'evidence',
    label: 'Evidence',
    description: 'Inspect audit, security, provenance, and exportable evidence.',
    baseRoute: '/governance/evidence',
    railDefaultOpen: true,
    destinations: [
      {
        id: 'overview',
        label: 'Overview',
        description: 'Evidence posture and coverage.',
        route: '/governance/evidence',
      },
      {
        id: 'audit',
        label: 'Audit',
        description: 'Audit evidence.',
        route: '/governance/evidence/audit',
      },
      {
        id: 'security',
        label: 'Security',
        description: 'Security evidence.',
        route: '/governance/evidence/security',
      },
      {
        id: 'provenance',
        label: 'Provenance',
        description: 'Execution provenance.',
        route: '/governance/evidence/provenance',
      },
      {
        id: 'export',
        label: 'Export',
        description: 'Evidence exports.',
        route: '/governance/evidence/export',
      },
    ],
  },
  {
    id: 'governance-trust',
    ownerId: 'trust',
    label: 'Trust & regulatory',
    description: 'Manage regulatory frameworks, controls, attestations, and reports.',
    baseRoute: '/governance/trust',
    railDefaultOpen: true,
    destinations: [
      {
        id: 'overview',
        label: 'Overview',
        description: 'Trust and regulatory posture.',
        route: '/governance/trust',
      },
      {
        id: 'regulatory',
        label: 'Regulatory',
        description: 'Frameworks and controls.',
        route: '/governance/trust/regulatory',
      },
      {
        id: 'reports',
        label: 'Reports',
        description: 'Trust and compliance reports.',
        route: '/governance/trust/reports',
      },
    ],
  },
  {
    id: 'data-lineage',
    ownerId: 'lineage',
    label: 'Lineage',
    description: 'Trace datasets, processing jobs, and source-to-answer execution provenance.',
    baseRoute: '/data/lineage',
    railDefaultOpen: true,
    destinations: LINEAGE_DESTINATIONS,
  },
  {
    id: 'runtime-models',
    ownerId: 'models',
    label: 'Models',
    description: 'Manage model availability, routing, traffic, providers, and tuning.',
    baseRoute: '/runtime/models',
    railDefaultOpen: true,
    destinations: MODEL_DESTINATIONS,
  },
  {
    id: 'runtime-api-budgets',
    ownerId: 'api-budgets',
    label: 'API & budgets',
    description: 'Manage API keys, machine clients, and enforceable consumption budgets.',
    baseRoute: '/runtime/api-budgets',
    railDefaultOpen: true,
    destinations: API_BUDGET_DESTINATIONS,
  },
  {
    id: 'insights-ai',
    ownerId: 'ai-behavior',
    label: 'AI behavior',
    description: 'Inspect AI traces, prompt behavior, and operator-assisted analysis.',
    baseRoute: '/insights/ai',
    railDefaultOpen: true,
    destinations: INSIGHTS_AI_DESTINATIONS,
  },
  {
    id: 'insights-quality',
    ownerId: 'quality-results',
    label: 'Quality',
    description: 'Monitor scorecards, drift, and quality thresholds across deployed solutions.',
    baseRoute: '/insights/quality',
    railDefaultOpen: true,
    destinations: INSIGHTS_QUALITY_DESTINATIONS,
  },
  {
    id: 'operations-health',
    ownerId: 'platform-health',
    label: 'Platform health',
    description: 'Inspect live metrics, logs, and traces across the platform.',
    baseRoute: '/operations/health',
    railDefaultOpen: true,
    destinations: HEALTH_DESTINATIONS,
  },
  {
    id: 'operations-configuration',
    ownerId: 'configuration',
    label: 'Configuration',
    description: 'Manage platform settings, feature flags, adapters, and messaging.',
    baseRoute: '/operations/configuration',
    railDefaultOpen: true,
    destinations: CONFIGURATION_DESTINATIONS,
  },
  {
    id: 'operations-edge',
    ownerId: 'edge',
    label: 'Edge',
    description: 'Inspect and control public routing, WAF, traffic, and blocked requests.',
    baseRoute: '/operations/edge',
    railDefaultOpen: true,
    destinations: EDGE_DESTINATIONS,
  },
  {
    id: 'operations-admin',
    ownerId: 'admin',
    label: 'Admin',
    description: 'Manage organization settings and tenant lifecycle.',
    baseRoute: '/operations/admin',
    railDefaultOpen: true,
    destinations: ADMIN_DESTINATIONS,
  },
  {
    id: 'data-flows',
    ownerId: 'data-flows',
    label: 'Flows',
    description: 'Operate replication syncs and orchestrated data movement.',
    baseRoute: '/data/flows',
    railDefaultOpen: true,
    destinationScope: 'exact',
    destinations: FLOW_DESTINATIONS,
  },
  {
    id: 'data-warehouse',
    ownerId: 'warehouse',
    label: 'Warehouse',
    description: 'Inspect warehouse tables and run governed read-only queries.',
    baseRoute: '/data/warehouse',
    railDefaultOpen: true,
    destinationScope: 'exact',
    destinations: WAREHOUSE_DESTINATIONS,
  },
  {
    id: 'data-catalog',
    ownerId: 'catalog',
    label: 'Catalog',
    description: 'Manage data assets and the governance controls applied to them.',
    baseRoute: '/data/catalog',
    railDefaultOpen: true,
    destinationScope: 'exact',
    destinations: CATALOG_DESTINATIONS,
  },
  {
    id: 'data-knowledge',
    ownerId: 'knowledge',
    label: 'Knowledge',
    description: 'Curate governed knowledge collections and retrieval indexes.',
    baseRoute: '/data/knowledge',
    railDefaultOpen: true,
    destinationScope: 'exact',
    destinations: KNOWLEDGE_DESTINATIONS,
  },
  {
    id: 'insights-usage',
    ownerId: 'usage',
    label: 'Usage',
    description: 'Inspect request traffic, latency, adoption, and governed dashboards.',
    baseRoute: '/insights/usage',
    railDefaultOpen: true,
    destinations: INSIGHTS_USAGE_DESTINATIONS,
  },
  {
    id: 'insights-cost',
    ownerId: 'cost',
    label: 'Cost',
    description: 'Attribute AI usage and spend across users, projects, and models.',
    baseRoute: '/insights/cost',
    railDefaultOpen: true,
    destinations: INSIGHTS_COST_DESTINATIONS,
  },
  {
    id: 'operations-nodes',
    ownerId: 'nodes',
    label: 'Physical nodes',
    description: 'Inspect registry-driven physical nodes and their compute-cluster relationships.',
    baseRoute: '/operations/nodes',
    railDefaultOpen: true,
    destinationScope: 'exact',
    destinations: NODE_DESTINATIONS,
  },
] as const;

function stripUrlDecoration(value: string): string {
  const path = value.split(/[?#]/, 1)[0] || '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function pathIsWithin(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function destinationOwnsPath(
  module: ContextualModule,
  destination: ContextualDestination,
  pathname: string,
): boolean {
  // A default leaf may intentionally share the module root. Treat that root as exact so entity
  // detail routes such as /data/catalog/[id] and /operations/nodes/[id] keep their own lifecycle
  // shell instead of being mistaken for the collection overview.
  return module.destinationScope === 'exact' || destination.route === module.baseRoute
    ? pathname === destination.route
    : pathIsWithin(pathname, destination.route);
}

export function contextualModule(id: ContextualModuleId): ContextualModule {
  const module = CONTEXTUAL_MODULES.find((candidate) => candidate.id === id);
  if (!module) throw new Error(`Unknown contextual module: ${id}`);
  return module;
}

export function contextualModuleForPath(url: string): ContextualModule | undefined {
  const pathname = stripUrlDecoration(url);
  return CONTEXTUAL_MODULES.find(
    (module) =>
      pathname === module.baseRoute ||
      module.destinations.some((destination) => destinationOwnsPath(module, destination, pathname)),
  );
}

export function contextualModuleForOwner(ownerId: CanonicalOwnerId): ContextualModule | undefined {
  return CONTEXTUAL_MODULES.find((module) => module.ownerId === ownerId);
}

export function contextualDestinationForPath(
  module: ContextualModule,
  url: string,
): ContextualDestination | undefined {
  const pathname = stripUrlDecoration(url);
  return module.destinations
    .filter((destination) => destinationOwnsPath(module, destination, pathname))
    .sort((a, b) => b.route.length - a.route.length)[0];
}

export function contextualDestination(
  module: ContextualModule,
  rawId: string | undefined | null,
): ContextualDestination | undefined {
  return module.destinations.find((destination) => destination.id === rawId);
}

export function defaultContextualDestination(module: ContextualModule): ContextualDestination {
  const destination = module.destinations[0];
  if (!destination) throw new Error(`Contextual module ${module.id} has no destinations`);
  return destination;
}
