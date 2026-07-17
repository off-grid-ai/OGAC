import type { CanonicalOwnerId } from './ownership';

export type ContextualModuleId =
  | 'solutions-tools'
  | 'solutions-quality'
  | 'governance-policies'
  | 'governance-access'
  | 'governance-guardrails'
  | 'governance-secrets'
  | 'governance-evidence'
  | 'governance-trust';
export type ContextualDestinationId =
  | 'registered'
  | 'catalog'
  | 'primitives'
  | 'evaluators'
  | 'golden-cases'
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
  | 'reports';

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
        id: 'runs',
        label: 'Executions',
        description: 'Launch, re-run, and inspect individual evaluation executions.',
        route: '/solutions/quality/runs',
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
    destinations: [
      {
        id: 'overview',
        label: 'Overview',
        description: 'Protection posture and reachability.',
        route: '/governance/guardrails/overview',
      },
      {
        id: 'protections',
        label: 'Standard protections',
        description: 'Built-in protection controls.',
        route: '/governance/guardrails/protections',
      },
      {
        id: 'masking',
        label: 'Masking rules',
        description: 'Masking and redaction behavior.',
        route: '/governance/guardrails/masking',
      },
      {
        id: 'recognizers',
        label: 'Recognizers & deny lists',
        description: 'Custom detection rules.',
        route: '/governance/guardrails/recognizers',
      },
      {
        id: 'thresholds',
        label: 'Thresholds',
        description: 'Enforcement thresholds.',
        route: '/governance/guardrails/thresholds',
      },
      {
        id: 'test',
        label: 'Test',
        description: 'Exercise protections before rollout.',
        route: '/governance/guardrails/test',
      },
    ],
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
] as const;

function stripUrlDecoration(value: string): string {
  const path = value.split(/[?#]/, 1)[0] || '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function pathIsWithin(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function contextualModule(id: ContextualModuleId): ContextualModule {
  const module = CONTEXTUAL_MODULES.find((candidate) => candidate.id === id);
  if (!module) throw new Error(`Unknown contextual module: ${id}`);
  return module;
}

export function contextualModuleForPath(url: string): ContextualModule | undefined {
  const pathname = stripUrlDecoration(url);
  return CONTEXTUAL_MODULES.find((module) => pathIsWithin(pathname, module.baseRoute));
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
    .filter((destination) => pathIsWithin(pathname, destination.route))
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
