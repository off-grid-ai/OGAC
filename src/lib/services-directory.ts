// The Off Grid AI service/product directory — every public surface in the suite, in one
// place. Powers the /services page (a health-checked map of what we run) and is the
// single source of truth for "which subdomains exist".
//
// Override for a given deployment with OFFGRID_SERVICES (a JSON array matching
// ServiceEntry). Unset => the default suite below.

// How a service's health is determined:
//  · 'network'  — the default: HTTP-probe the URL and report up/down (a 401/302 counts as up).
//  · 'embedded' — an in-process/on-disk backend (e.g. LanceDB). There is no endpoint to hit;
//                 a network probe is meaningless and would always read 'unreachable'. It runs
//                 inside the console, so it's healthy whenever the console is.
//  · 'optional' — a best-effort external dependency the app degrades past gracefully (e.g.
//                 Redis: the cache falls back to an in-process store when it's absent). If it
//                 answers it's 'up'; if not, that's the expected fallback state, NOT an outage.
export type ProbeMode = 'network' | 'embedded' | 'optional';

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
  /** Health-probe strategy. Defaults to 'network'. */
  probe?: ProbeMode;
  /**
   * For an 'optional' service, the state to SHOW when it doesn't answer — the honest name of
   * the fallback (e.g. 'in-process cache'), rendered instead of a scary 'down'.
   */
  fallbackLabel?: string;
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
  {
    id: 'lancedb',
    label: 'LanceDB',
    description: 'Embedded vector store — the default Brain/RAG backend, on-disk inside the console (Qdrant is the server-scale swap-in).',
    // Embedded: runs in-process (@lancedb/lancedb on-disk). No endpoint to hit — a network probe
    // would always read 'unreachable'. It's healthy whenever the console is, so probe = embedded.
    url: 'embedded://lancedb',
    auth: 'session',
    kind: 'api',
    probe: 'embedded',
  },
  {
    id: 'redis',
    label: 'Redis',
    description: 'Optional response-cache backend. When absent, the cache falls back to an in-process store — no outage.',
    // Optional dependency: the caching port degrades to in-process memory if Redis is unreachable
    // (see src/lib/redis.ts). So "not answering" is the expected fallback, not a failure.
    url: process.env.OFFGRID_REDIS_URL ?? 'redis://127.0.0.1:6379',
    auth: 'api-key',
    kind: 'api',
    probe: 'optional',
    fallbackLabel: 'in-process cache',
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

// Honest health states:
//  · 'up'       — answered (or a gate answered 401/302).
//  · 'down'     — a network-probed service failed (5xx / timeout / unreachable). A real outage.
//  · 'embedded' — an in-process backend; healthy, no network probe was run.
//  · 'optional' — an optional dependency that isn't answering; the app is on its documented
//                 fallback. Non-alarming — NOT an outage.
export type HealthStatus = 'up' | 'down' | 'embedded' | 'optional';

export interface ServiceHealth {
  id: string;
  status: HealthStatus;
  httpStatus: number | null;
  ms: number | null;
  error?: string;
  /** Human label for the current state — e.g. the fallback name for an 'optional' service. */
  detail?: string;
}

// The raw outcome of a network probe (see src/lib/status.ts#probeService). Split out so the
// state decision below stays pure and unit-testable without any I/O.
export interface RawProbe {
  status: 'up' | 'down';
  httpStatus: number | null;
  ms: number | null;
  error?: string;
}

/**
 * PURE health-state decision. Maps a service's probe mode + (optional) raw network result to the
 * honest status the UI shows. Zero-IO — the caller decides whether to run a network probe.
 *
 *  · embedded → always 'embedded' (no probe; healthy with the console).
 *  · optional → 'up' if it answered, else 'optional' (on the documented fallback, not down).
 *  · network  → passes the raw up/down straight through.
 *
 * `raw` is omitted for embedded services (there's nothing to probe).
 */
export function resolveHealth(entry: ServiceEntry, raw?: RawProbe): ServiceHealth {
  const mode: ProbeMode = entry.probe ?? 'network';

  if (mode === 'embedded') {
    return { id: entry.id, status: 'embedded', httpStatus: null, ms: null, detail: 'embedded / healthy' };
  }

  if (mode === 'optional') {
    if (raw && raw.status === 'up') {
      return { id: entry.id, status: 'up', httpStatus: raw.httpStatus, ms: raw.ms };
    }
    const fallback = entry.fallbackLabel ?? 'fallback';
    return { id: entry.id, status: 'optional', httpStatus: null, ms: null, detail: `${fallback} (optional)` };
  }

  // network
  return {
    id: entry.id,
    status: raw?.status ?? 'down',
    httpStatus: raw?.httpStatus ?? null,
    ms: raw?.ms ?? null,
    error: raw?.error,
  };
}

/** True when a service needs a real network probe (embedded ones never do). */
export function needsNetworkProbe(entry: ServiceEntry): boolean {
  return (entry.probe ?? 'network') !== 'embedded';
}

/** Healthy = not a real outage. Embedded backends and optional deps on fallback count as healthy. */
export function isHealthy(status: HealthStatus): boolean {
  return status !== 'down';
}

// ─── Management honesty (Task C3) ──────────────────────────────────────────────────────────────
// The console does NOT hold a service-control plane — the internal services run as launchd jobs /
// Docker containers on the on-prem hosts, and there is deliberately no console→host restart path
// (that would be a large blast-radius capability the console isn't trusted with). So the detail
// view is honest about WHY a given service can't be restarted from here, per its kind, rather than
// showing a dead "Restart" button. This is a PURE mapping — no I/O.
export interface ServiceControl {
  /** Whether the console can restart/reload this service. Always false today (honest). */
  restartable: boolean;
  /** Human explanation of who actually manages this service's lifecycle. */
  managedBy: string;
}

export function serviceControl(entry: ServiceEntry): ServiceControl {
  if ((entry.probe ?? 'network') === 'embedded') {
    return {
      restartable: false,
      managedBy: 'Runs in-process inside the console — its lifecycle IS the console. Restart the console to restart it.',
    };
  }
  if (entry.kind === 'console') {
    return { restartable: false, managedBy: 'This control plane. Restart via the deploy runbook (next start on the host).' };
  }
  if (entry.kind === 'gateway' || entry.kind === 'api' || entry.kind === 'product') {
    return {
      restartable: false,
      managedBy: 'Managed by launchd / Docker on the on-prem host — not console-controllable. Restart it on the host (see the deploy runbook).',
    };
  }
  return { restartable: false, managedBy: 'Managed outside the console.' };
}

/** Find a service entry by id (for the detail view). */
export function findService(services: ServiceEntry[], id: string): ServiceEntry | undefined {
  return services.find((s) => s.id === id);
}
