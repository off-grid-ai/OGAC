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
  kind: 'console' | 'product' | 'api' | 'site' | 'gateway';
}

const DEFAULT_SERVICES: ServiceEntry[] = [
  // ── Public surfaces (through the Cloudflare tunnel) ──────────────────────────
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
    url: 'https://ai.getoffgridai.co',
    healthPath: '/healthz',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'edge-gateway',
    label: 'Network Gateway',
    description: 'The public HTTP edge (Caddy reverse proxy, WAF, rate limiting) fronting the API.',
    url: 'https://gateway.getoffgridai.co',
    healthPath: '/healthz',
    auth: 'public',
    kind: 'gateway',
  },
  {
    id: 'gungnir',
    label: 'Gungnir',
    description: 'Visual QA — repos, features, behaviors, test recordings.',
    url: 'https://gungnir.getoffgridai.co',
    auth: 'session',
    kind: 'product',
  },

  // ── Internal fleet services (LAN — probed by their direct IP:port) ───────────
  {
    id: 'keycloak',
    label: 'Keycloak',
    description: 'Identity & access management — SSO, realm, service accounts.',
    url: process.env.OFFGRID_KEYCLOAK_URL ?? 'http://127.0.0.1:8080',
    healthPath: '/health/ready',
    auth: 'session',
    kind: 'api',
  },
  {
    id: 'qdrant',
    label: 'Qdrant',
    description: 'Vector store — Brain / RAG retrieval backend.',
    url: process.env.OFFGRID_QDRANT_URL ?? 'http://127.0.0.1:6333',
    healthPath: '/healthz',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'opensearch',
    label: 'OpenSearch',
    description: 'SIEM / log search — gateway analytics, audit logs, dashboards.',
    url: process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200',
    healthPath: '/_cluster/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'langfuse',
    label: 'Langfuse',
    description: 'LLM observability — traces, eval scores, session replay.',
    url: process.env.OFFGRID_LANGFUSE_URL ?? 'http://192.168.1.60:3030',
    healthPath: '/api/public/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'temporal',
    label: 'Temporal',
    description: 'Durable workflows — agent runs, long-running tasks.',
    url: 'http://127.0.0.1:8081',
    healthPath: '/',
    auth: 'session',
    kind: 'api',
  },
  {
    id: 'opa',
    label: 'OPA',
    description: 'Open Policy Agent — ABAC policy evaluation.',
    url: 'http://127.0.0.1:8181',
    healthPath: '/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'openbao',
    label: 'OpenBao',
    description: 'Secrets vault — API keys, credentials, rotation.',
    url: 'http://127.0.0.1:8200',
    healthPath: '/v1/sys/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'marquez',
    label: 'Marquez',
    description: 'Data lineage — OpenLineage-compatible source→answer provenance.',
    url: 'http://127.0.0.1:9000',
    healthPath: '/api/v1/namespaces',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'unleash',
    label: 'Unleash',
    description: 'Feature flags — capability toggles per org / user.',
    url: process.env.OFFGRID_UNLEASH_URL ?? 'http://192.168.1.60:4242',
    healthPath: '/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'presidio',
    label: 'Presidio',
    description: 'PII detection & anonymisation — data masking for ingest.',
    url: 'http://192.168.1.60:5002',
    healthPath: '/health',
    auth: 'api-key',
    kind: 'api',
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
