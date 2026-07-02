// The Off Grid service/product directory — every public surface in the suite, in one
// place. Powers the /services page (a health-checked map of what we run) and is the
// single source of truth for "which subdomains exist".
//
// Override for a given deployment with OFFGRID_SERVICES (a JSON array matching
// ServiceEntry). Unset => the default suite below.

export interface ServiceEntry {
  id: string;
  label: string;
  description: string;
  /** Public URL users open. */
  url: string;
  /** Path probed for health (server-side). Defaults to '/'. */
  healthPath?: string;
  /** How it's protected — shown as a badge. */
  auth: 'session' | 'api-key' | 'public';
  /** Grouping for the UI. */
  kind: 'console' | 'product' | 'api' | 'site';
}

const DEFAULT_SERVICES: ServiceEntry[] = [
  {
    id: 'console',
    label: 'Console',
    description: 'This control plane — fleet, models, data, agents, and governance.',
    url: 'https://onprem-console.getoffgridai.co',
    healthPath: '/signin',
    auth: 'session',
    kind: 'console',
  },
  {
    id: 'gateway',
    label: 'AI Gateway',
    description: 'The multinode LLM gateway — OpenAI-compatible, load-balanced across the fleet.',
    url: 'https://gateway.getoffgridai.co',
    healthPath: '/healthz',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Live fleet + service status page.',
    url: 'https://console-status.getoffgridai.co',
    auth: 'session',
    kind: 'product',
  },
  {
    id: 'landing',
    label: 'Landing',
    description: 'On-prem console landing / overview.',
    url: 'https://console-landing.getoffgridai.co',
    auth: 'session',
    kind: 'product',
  },
  {
    id: 'gungnir',
    label: 'Gungnir',
    description: 'Gungnir surface.',
    url: 'https://gungnir.getoffgridai.co',
    auth: 'session',
    kind: 'product',
  },
];

export function getServices(): ServiceEntry[] {
  const raw = process.env.OFFGRID_SERVICES?.trim();
  if (!raw) return DEFAULT_SERVICES;
  try {
    const parsed = JSON.parse(raw) as ServiceEntry[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_SERVICES;
  } catch {
    return DEFAULT_SERVICES;
  }
}

export interface ServiceHealth {
  id: string;
  status: 'up' | 'down';
  httpStatus: number | null;
  ms: number | null;
  error?: string;
}
