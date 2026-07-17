import type { CanonicalOwnerId } from './ownership';

export type ContextualModuleId = 'solutions-tools' | 'solutions-quality';
export type ContextualDestinationId =
  'registered' | 'catalog' | 'primitives' | 'evaluators' | 'golden-cases' | 'runs';

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
