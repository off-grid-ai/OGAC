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
    id: 'provit',
    label: 'Provit',
    description: 'Prove It — visual QA brokered through the console: intelligence engine (map repos, test copilot), gateway (shared), file upload, repos, runs.',
    url: process.env.OFFGRID_PROVIT_URL ?? 'https://provit.getoffgridai.co',
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
    // Runs in the offgrid-services-a stack ON S1 → reached over loopback (127.0.0.1). These S1-
    // local services are loopback-bound (not LAN-reachable) for hardening; the console reaches
    // them on 127.0.0.1. (mDNS/offgrid-gN.local is for OTHER hosts, e.g. g6 via edge proxies.)
    // AUTH: today the security plugin is DISABLED (anon loopback reads). Phase-D native-OIDC/JWT
    // (Keycloak login for Dashboards + Bearer on the REST API) is READY to flip — see
    // deploy/onprem/oidc-services.md § 1 + KC client offgrid-opensearch. Not enabled on the live cluster.
    url: process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200',
    healthPath: '/_cluster/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'langfuse',
    label: 'Langfuse',
    description: 'LLM observability — traces, eval scores, session replay.',
    // On g6 (aux tier). The console can't reach the LAN directly, so it goes through the S1
    // edge-Caddy loopback proxy (8931→offgrid-g6.local:3030). Env override sets this on S1.
    url: process.env.OFFGRID_LANGFUSE_URL ?? 'http://127.0.0.1:8931',
    healthPath: '/api/public/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'temporal',
    label: 'Temporal',
    description: 'Durable workflows — agent runs, long-running tasks.',
    url: process.env.OFFGRID_TEMPORAL_UI_URL ?? 'http://127.0.0.1:8081',
    healthPath: '/',
    auth: 'session',
    kind: 'api',
  },
  {
    id: 'opa',
    label: 'OPA',
    description: 'Open Policy Agent — ABAC policy evaluation.',
    url: process.env.OFFGRID_OPA_URL ?? 'http://127.0.0.1:8181',
    healthPath: '/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'openbao',
    label: 'OpenBao',
    description: 'Secrets vault — API keys, credentials, rotation.',
    url: process.env.OFFGRID_OPENBAO_URL ?? 'http://127.0.0.1:8200',
    healthPath: '/v1/sys/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'marquez',
    label: 'Marquez',
    description: 'Data lineage — OpenLineage-compatible source→answer provenance.',
    url: process.env.OFFGRID_MARQUEZ_URL ?? 'http://127.0.0.1:9000',
    healthPath: '/api/v1/namespaces',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'unleash',
    label: 'Unleash',
    description: 'Feature flags — capability toggles per org / user.',
    // On g6 — via the S1 edge-Caddy loopback proxy (8932→offgrid-g6.local:4242). Env override on S1.
    url: process.env.OFFGRID_UNLEASH_URL ?? 'http://127.0.0.1:8932',
    healthPath: '/health',
    auth: 'api-key',
    kind: 'api',
  },
  {
    id: 'presidio',
    label: 'Presidio',
    description: 'PII detection & anonymisation — data masking for ingest.',
    // On g6 (LAN). The console can't reach it directly; it needs an edge-Caddy loopback proxy
    // (8938 staged in the Caddyfile, pending an edge reload). Env override points at the loopback.
    url: process.env.OFFGRID_PRESIDIO_URL ?? 'http://127.0.0.1:8938',
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
