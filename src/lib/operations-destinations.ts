export const HEALTH_DESTINATIONS = [
  {
    id: 'metrics',
    label: 'Metrics',
    description: 'Read live service and infrastructure metrics from VictoriaMetrics.',
    route: '/operations/health/metrics',
  },
  {
    id: 'logs',
    label: 'Logs',
    description: 'Search live platform logs with a durable LogsQL query.',
    route: '/operations/health/logs',
  },
  {
    id: 'traces',
    label: 'Traces',
    description: 'Inspect recent service traces and open full waterfalls in Jaeger.',
    route: '/operations/health/traces',
  },
] as const;

export const CONFIGURATION_DESTINATIONS = [
  {
    id: 'settings',
    label: 'Settings',
    description: 'Manage deployment settings and the workspace pipeline binding.',
    route: '/operations/configuration/settings',
  },
  {
    id: 'feature-flags',
    label: 'Feature flags',
    description: 'Manage runtime capability switches without a redeploy.',
    route: '/operations/configuration/feature-flags',
  },
  {
    id: 'adapters',
    label: 'Adapters',
    description: 'Inspect active capability adapters and their available replacements.',
    route: '/operations/configuration/adapters',
  },
  {
    id: 'messaging',
    label: 'Messaging',
    description: 'Manage outbound delivery, verified domains, and inbound app addresses.',
    route: '/operations/configuration/messaging',
  },
] as const;

export const EDGE_DESTINATIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Read edge reachability, request volume, and the active protection posture.',
    route: '/operations/edge/overview',
  },
  {
    id: 'waf',
    label: 'WAF',
    description: 'Enable the web application firewall and manage its rules.',
    route: '/operations/edge/waf',
  },
  {
    id: 'traffic',
    label: 'Traffic',
    description: 'Inspect recent allowed and blocked HTTP requests at the public edge.',
    route: '/operations/edge/traffic',
  },
  {
    id: 'blocked-requests',
    label: 'Blocked requests',
    description: 'Search and sort requests refused by the WAF or rate limiter.',
    route: '/operations/edge/blocked-requests',
  },
] as const;

export const ADMIN_DESTINATIONS = [
  {
    id: 'organization',
    label: 'Organization',
    description: 'Manage organization-wide instructions and reach governed access controls.',
    route: '/operations/admin/organization',
  },
  {
    id: 'tenants',
    label: 'Tenants',
    description: 'Provision and remove tenant organizations and their enabled modules.',
    route: '/operations/admin/tenants',
  },
] as const;

type Destination =
  | (typeof HEALTH_DESTINATIONS)[number]
  | (typeof CONFIGURATION_DESTINATIONS)[number]
  | (typeof EDGE_DESTINATIONS)[number]
  | (typeof ADMIN_DESTINATIONS)[number];

export type OperationsDestinationId = Destination['id'];
export type HealthDestinationId = (typeof HEALTH_DESTINATIONS)[number]['id'];
export type ConfigurationDestinationId = (typeof CONFIGURATION_DESTINATIONS)[number]['id'];
export type EdgeDestinationId = (typeof EDGE_DESTINATIONS)[number]['id'];
export type AdminDestinationId = (typeof ADMIN_DESTINATIONS)[number]['id'];

export type RouteSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export function operationsDestination<Dest extends Destination>(
  destinations: readonly Dest[],
  rawId: string | null | undefined,
): Dest | undefined {
  return destinations.find((candidate) => candidate.id === rawId);
}

export function withRouteSearchParams(route: string, params: RouteSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      query.set(key, value);
    } else if (value !== undefined) {
      for (const item of value) query.append(key, item);
    }
  }
  const suffix = query.toString();
  return suffix ? `${route}?${suffix}` : route;
}

export function legacyHealthHref(params: RouteSearchParams): string {
  const rawTab = params.tab;
  const tab = typeof rawTab === 'string' ? rawTab : rawTab?.at(0);
  const destination = operationsDestination(HEALTH_DESTINATIONS, tab) ?? HEALTH_DESTINATIONS[0];
  const { tab: _tab, ...rest } = params;
  return withRouteSearchParams(destination.route, rest);
}

export function formatRelativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return 'never';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
