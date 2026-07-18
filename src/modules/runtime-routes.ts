export type LegacyGatewayQuery = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

const LEGACY_GATEWAY_DESTINATIONS: Readonly<Record<string, string>> = {
  overview: '/runtime/models/overview',
  router: '/runtime/models/routing',
  traffic: '/runtime/models/traffic',
  logs: '/runtime/models/logs',
  control: '/runtime/models/fleet-control',
  providers: '/runtime/models/providers',
  tuning: '/runtime/models/tuning',
  keys: '/runtime/api-budgets/keys',
  tokens: '/runtime/api-budgets/clients',
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
