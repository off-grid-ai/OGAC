export type LegacyGatewayQuery = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Canonical route vocabulary consumed by both the contextual rail and route handlers. */
export const MODEL_DESTINATIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Model catalog and serving posture.',
    route: '/runtime/models/overview',
  },
  {
    id: 'routing',
    label: 'Routing',
    description: 'Model routing policies and fallbacks.',
    route: '/runtime/models/routing',
  },
  {
    id: 'traffic',
    label: 'Traffic',
    description: 'Current model request traffic.',
    route: '/runtime/models/traffic',
  },
  {
    id: 'logs',
    label: 'Logs',
    description: 'Model gateway request logs.',
    route: '/runtime/models/logs',
  },
  {
    id: 'fleet-control',
    label: 'Fleet control',
    description: 'Model serving controls across the fleet.',
    route: '/runtime/models/fleet-control',
  },
  {
    id: 'providers',
    label: 'Providers',
    description: 'Available model providers and endpoints.',
    route: '/runtime/models/providers',
  },
  {
    id: 'tuning',
    label: 'Tuning',
    description: 'Model tuning and runtime parameters.',
    route: '/runtime/models/tuning',
  },
  {
    id: 'spend',
    label: 'Spend',
    description: 'Cost, tokens, and request volume attributed by model, key, and time.',
    route: '/runtime/models/spend',
  },
  {
    id: 'cache',
    label: 'Cache',
    description: 'Response-cache status, flush controls, and hit-rate / tokens-saved.',
    route: '/runtime/models/cache',
  },
] as const;

export const API_BUDGET_DESTINATIONS = [
  {
    id: 'keys',
    label: 'Keys',
    description: 'API keys and credentials.',
    route: '/runtime/api-budgets/keys',
  },
  {
    id: 'clients',
    label: 'Clients',
    description: 'Machine clients and access scopes.',
    route: '/runtime/api-budgets/clients',
  },
  {
    id: 'budgets',
    label: 'Budgets',
    description: 'Usage ceilings and enforcement state.',
    route: '/runtime/api-budgets/budgets',
  },
] as const;

function routeForId(destinations: readonly { id: string; route: string }[], id: string): string {
  const destination = destinations.find((candidate) => candidate.id === id);
  if (!destination) throw new Error(`Unknown runtime destination: ${id}`);
  return destination.route;
}

const LEGACY_GATEWAY_DESTINATIONS: Readonly<Record<string, string>> = {
  overview: routeForId(MODEL_DESTINATIONS, 'overview'),
  router: routeForId(MODEL_DESTINATIONS, 'routing'),
  traffic: routeForId(MODEL_DESTINATIONS, 'traffic'),
  logs: routeForId(MODEL_DESTINATIONS, 'logs'),
  control: routeForId(MODEL_DESTINATIONS, 'fleet-control'),
  providers: routeForId(MODEL_DESTINATIONS, 'providers'),
  tuning: routeForId(MODEL_DESTINATIONS, 'tuning'),
  keys: routeForId(API_BUDGET_DESTINATIONS, 'keys'),
  tokens: routeForId(API_BUDGET_DESTINATIONS, 'clients'),
  settings: '/operations/configuration',
};

/**
 * Translate the retired AI Gateway tab URL into the one canonical owner for that place.
 * Non-tab query state (for example the fleet node configure panel) survives the migration.
 */
export function legacyGatewayRedirect(query: LegacyGatewayQuery): string {
  const rawTab = query.tab;
  const tab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const destination =
    (typeof tab === 'string' && LEGACY_GATEWAY_DESTINATIONS[tab]) ||
    LEGACY_GATEWAY_DESTINATIONS.overview;
  const nextQuery = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (key === 'tab' || value === undefined) continue;
    if (typeof value === 'string') nextQuery.set(key, value);
    else value.forEach((item) => nextQuery.append(key, item));
  }

  const encoded = nextQuery.toString();
  return encoded ? `${destination}?${encoded}` : destination;
}
