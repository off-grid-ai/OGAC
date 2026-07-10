import type { AdapterMeta } from './types';

// OSS service adapters for the capabilities reached purely over HTTP (policy, identity, lineage)
// plus the additional options for guardrails / retrieval / observability. Each carries its
// AdapterMeta and an optional health() that pings the live service — that ping IS the "connection".
// First-party defaults (RBAC/ABAC, Auth.js, the checks spine, LanceDB) sit first so the console
// works with zero OSS; the OSS entries are swap-in alternatives via OFFGRID_ADAPTER_<CAP>.
const env = process.env;

export interface RegEntry {
  meta: AdapterMeta;
  health?: () => Promise<boolean>;
}

function ping(url: string | undefined, path = '/'): () => Promise<boolean> {
  return async () => {
    if (!url) return false;
    try {
      const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  };
}

export const POLICY: RegEntry[] = [
  {
    meta: {
      id: 'abac',
      capability: 'policy',
      vendor: 'Off Grid AI RBAC + ABAC',
      license: 'first-party',
      render: 'native',
      description: 'Deny-overrides ABAC + RBAC evaluated in-console (always on).',
    },
  },
  {
    meta: {
      id: 'opa',
      capability: 'policy',
      vendor: 'Open Policy Agent',
      license: 'Apache-2.0',
      render: 'headless',
      embedUrl: env.OFFGRID_OPA_URL,
      description: 'Policy-as-code decision API for complex authorization.',
    },
    health: ping(env.OFFGRID_OPA_URL, '/health'),
  },
];

export const IDENTITY: RegEntry[] = [
  {
    meta: {
      id: 'authjs',
      capability: 'identity',
      vendor: 'Auth.js',
      license: 'ISC',
      render: 'native',
      description: 'SSO via Google / Microsoft Entra (+ dev login). Default.',
    },
  },
  {
    meta: {
      id: 'keycloak',
      capability: 'identity',
      vendor: 'Keycloak',
      license: 'Apache-2.0',
      render: 'embed',
      embedUrl: env.OFFGRID_KEYCLOAK_URL,
      description: 'Full IAM — SSO / SAML / OIDC / federation. Admin as an SSO embed.',
    },
    health: ping(env.OFFGRID_KEYCLOAK_URL, '/'),
  },
];

export const LINEAGE: RegEntry[] = [
  {
    meta: {
      id: 'native',
      capability: 'lineage',
      vendor: 'Off Grid AI (implicit)',
      license: 'first-party',
      render: 'native',
      description: 'Lineage implicit in the audit trace; no separate graph (default, zero-OSS).',
    },
  },
  {
    meta: {
      id: 'marquez',
      capability: 'lineage',
      vendor: 'OpenLineage + Marquez',
      license: 'Apache-2.0',
      render: 'embed',
      embedUrl: env.OFFGRID_MARQUEZ_WEB_URL,
      description: 'Dataset/job/run lineage; pairs with grounding for source→answer provenance.',
    },
    health: ping(env.OFFGRID_MARQUEZ_URL, '/api/v1/namespaces'),
  },
];

// Content guardrails: LLM Guard is THE authoritative engine (founder DRY consolidation). It leads
// the list so it is the DEFAULT the registry picks. The `regex-floor` entry below is NOT a selectable
// content-guardrail engine — it is the meta for the pure regex detector the DATA-MOVEMENT redaction
// path reuses (regexPii in adapters/pii.ts); it carries no health probe (no service to reach).
export const GUARDRAIL_ENTRIES: RegEntry[] = [
  {
    // LLM Guard (Protect AI) — the sole content-guardrail engine, behind the PiiPort `llmGuardPii`
    // (adapters/guardrail-provider.ts). Configured with OFFGRID_HTTP_GUARDRAIL_URL (+ _API_KEY =
    // AUTH_TOKEN). FAIL CLOSED when configured-but-down; surfaced "not configured" when no URL is set.
    meta: {
      id: 'llm-guard',
      capability: 'guardrails',
      vendor: 'LLM Guard (Protect AI)',
      license: 'MIT',
      render: 'headless',
      embedUrl: env.OFFGRID_HTTP_GUARDRAIL_URL,
      description:
        'The authoritative content-guardrail engine — self-hosted LLM Guard scanners (PII/Anonymize with the India recognizers folded in, Secrets, PromptInjection, Toxicity, Bias, BanTopics, Language, Regex, TokenLimit). POSTs the text + the console scanner config to /analyze/prompt. FAIL CLOSED: configured + unreachable blocks the run; not configured is surfaced honestly. Configure OFFGRID_HTTP_GUARDRAIL_URL (the llm-guard-api base) + _API_KEY (AUTH_TOKEN).',
    },
    health: ping(env.OFFGRID_HTTP_GUARDRAIL_URL, '/healthz'),
  },
  {
    // Meta ONLY for the pure regex detector reused by the data-movement redaction path (not a
    // content-guardrail engine and never picked by the registry). No health probe.
    meta: {
      id: 'regex-floor',
      capability: 'guardrails',
      vendor: 'Off Grid AI regex floor',
      license: 'first-party',
      render: 'native',
      description:
        'Deterministic regex PII detector (email/phone + India PAN/Aadhaar/IFSC/UPI) reused by the data-movement redaction path. Not a content-guardrail engine — LLM Guard is the sole engine.',
    },
  },
];

export const RETRIEVAL_ENTRIES: RegEntry[] = [
  {
    meta: {
      id: 'lancedb',
      capability: 'retrieval',
      vendor: 'LanceDB',
      license: 'Apache-2.0',
      render: 'native',
      description: 'Embedded on-device vector store (default).',
    },
  },
  {
    meta: {
      id: 'pgvector',
      capability: 'retrieval',
      vendor: 'Postgres + pgvector',
      license: 'PostgreSQL',
      render: 'headless',
      description: 'Server-scale vectors in the Postgres you already run.',
    },
  },
  {
    meta: {
      id: 'qdrant',
      capability: 'retrieval',
      vendor: 'Qdrant',
      license: 'Apache-2.0',
      render: 'headless',
      embedUrl: env.OFFGRID_QDRANT_URL,
      description: 'Dedicated vector DB for large fleets.',
    },
    health: ping(env.OFFGRID_QDRANT_URL, '/healthz'),
  },
];

// Caching and feature flags are now real behavior ports (src/lib/adapters/cache.ts and flags.ts):
// the in-process default and the Redis / Unleash swap-ins actually perform the work in-path, with
// fallback to the default. Registered from those port arrays in the registry.

export const SIEM: RegEntry[] = [
  {
    meta: {
      id: 'audit',
      capability: 'siem',
      vendor: 'Off Grid AI audit store',
      license: 'first-party',
      render: 'native',
      description: 'Append-only audit/traffic log in Postgres (always on).',
    },
  },
  {
    meta: {
      id: 'opensearch',
      capability: 'siem',
      vendor: 'OpenSearch',
      license: 'Apache-2.0',
      render: 'embed',
      embedUrl: env.OFFGRID_OPENSEARCH_DASHBOARDS_URL,
      description: 'Log search + SIEM dashboards over the audit stream.',
    },
    health: ping(env.OFFGRID_OPENSEARCH_URL, '/'),
  },
];

// Provenance & citations. Three layers, each its own library/standard: (1) answer-level — verified
// citations via the grounding port (swap the model to HHEM-2.1-open / MiniCheck / Ragas); (2) data
// lineage — OpenLineage + Marquez; (3) content provenance — C2PA Content Credentials (sign answers/
// exports, tamper-evident) and Sigstore (keyless attestation). First-party chain is the default.
export const PROVENANCE: RegEntry[] = [
  {
    meta: {
      id: 'native',
      capability: 'provenance',
      vendor: 'Off Grid AI provenance chain',
      license: 'first-party',
      render: 'native',
      description:
        'Every answer carries source refs (router) + verified citations (grounding), recorded on the run/audit trace. Always on. Signs with HMAC-SHA256.',
    },
  },
  {
    meta: {
      id: 'ed25519',
      capability: 'provenance',
      vendor: 'Off Grid AI ed25519 signatures',
      license: 'first-party',
      render: 'headless',
      description:
        'Asymmetric (public-key) signatures over answers/exports — offline-verifiable with only the public key, no shared secret. The first step toward full C2PA/Sigstore.',
    },
  },
  {
    meta: {
      id: 'c2pa',
      capability: 'provenance',
      vendor: 'C2PA Content Credentials',
      license: 'permissive (CAI)',
      render: 'headless',
      description:
        'Content Credentials for image assets (PNG/JPEG) — embed a signed, offline-verifiable manifest via /admin/provenance/c2pa (c2pa-node, bundled signer). Text/document exports use ed25519 detached manifests.',
    },
  },
  {
    meta: {
      id: 'sigstore',
      capability: 'provenance',
      vendor: 'Sigstore',
      license: 'Apache-2.0',
      render: 'headless',
      description:
        'Keyless signing / attestation of artifacts & exports via /admin/provenance/sigstore (sigstore-js). Public-good Fulcio/Rekor (free, no key) or self-hosted via OFFGRID_FULCIO_URL/_REKOR_URL. Signing needs an OIDC identity token; verification is standalone.',
    },
  },
  {
    meta: {
      id: 'openlineage',
      capability: 'provenance',
      vendor: 'OpenLineage + Marquez',
      license: 'Apache-2.0',
      render: 'embed',
      embedUrl: env.OFFGRID_MARQUEZ_WEB_URL,
      description: 'Pipeline lineage: source → chunk → answer, as a queryable graph.',
    },
    health: ping(env.OFFGRID_MARQUEZ_URL, '/api/v1/namespaces'),
  },
];

// BI / data exploration in the data layer: view, query, pivot/transpose, dashboards. Superset is
// the permissive default (Apache-2.0, in the reference architecture); Metabase is an alternative
// but AGPL → embed-only (separate instance, never bundled). Transforms ("get to the right form")
// are dbt + Trino, in the data-engineering lane.
export const BI: RegEntry[] = [
  {
    meta: {
      id: 'superset',
      capability: 'bi',
      vendor: 'Apache Superset',
      license: 'Apache-2.0',
      render: 'embed',
      embedUrl: env.OFFGRID_SUPERSET_URL,
      description: 'Explore datasets: SQL Lab, charts, pivot/transpose, dashboards.',
    },
    health: ping(env.OFFGRID_SUPERSET_URL, '/health'),
  },
  {
    meta: {
      id: 'metabase',
      capability: 'bi',
      vendor: 'Metabase',
      license: 'AGPL-3.0 (embed-only)',
      render: 'embed',
      embedUrl: env.OFFGRID_METABASE_URL,
      description: 'Friendly BI/question builder. AGPL → run as a separate instance (aggregation).',
    },
    health: ping(env.OFFGRID_METABASE_URL, '/api/health'),
  },
];

// Runtime sandboxing for agent tool/code execution. Default is first-party "no-exec" (tools run
// only through the registered, scoped tool registry — arbitrary code is refused). The no-exec
// default, the Docker sandbox, AND Firecracker microVMs are real behavior ports now
// (src/lib/adapters/sandbox.ts). E2B (cloud, paid) and Falco (runtime threat detection) remain
// metadata swap-ins below.
export const SANDBOX: RegEntry[] = [
  {
    meta: {
      id: 'e2b',
      capability: 'sandbox',
      vendor: 'E2B (cloud — paid)',
      license: 'Apache-2.0',
      render: 'headless',
      embedUrl: env.OFFGRID_E2B_URL,
      status: 'planned',
      description:
        'Cloud microVM sandboxes. PAID (needs an E2B API key) — not used by default. The free OSS path is the Docker sandbox (default) or self-hosted Firecracker; nothing here requires payment.',
    },
  },
  {
    meta: {
      id: 'falco',
      capability: 'sandbox',
      vendor: 'Falco',
      license: 'Apache-2.0',
      render: 'headless',
      status: 'planned',
      description: 'Runtime threat detection on the execution host (syscall anomalies). Planned.',
    },
  },
];

// Evals and drift are now real behavior ports (src/lib/adapters/evals.ts, drift.ts): golden (the
// always-on default) plus promptfoo / Ragas (offline) and the first-party PSI detector / Evidently
// (drift) actually run in-path, with fallback to the default. Registered from those port arrays.

// Langfuse is an additional observability adapter (LLM traces + per-trace/user/project cost).
export const langfuseEntry: RegEntry = {
  meta: {
    id: 'langfuse',
    capability: 'observability',
    vendor: 'Langfuse',
    license: 'MIT',
    render: 'embed',
    embedUrl: env.OFFGRID_LANGFUSE_URL,
    description: 'LLM tracing, evals, and per-trace / user / project cost.',
  },
  health: ping(env.OFFGRID_LANGFUSE_URL, '/api/public/health'),
};

// Platform-telemetry observability adapters — the metrics/logs/traces backends fed by the OTel
// collector (one OTLP wire, any backend). Each is read back into the console's Platform-health page
// (src/lib/victoria-metrics.ts / victoria-logs.ts / jaeger.ts) AND surfaced here in Integrations
// with live health, exactly like Langfuse. VictoriaMetrics/VictoriaLogs expose a `/health` endpoint;
// Jaeger's query UI answers `/`.
export const victoriaMetricsEntry: RegEntry = {
  meta: {
    id: 'victoriametrics',
    capability: 'observability',
    vendor: 'VictoriaMetrics',
    license: 'Apache-2.0',
    render: 'headless',
    embedUrl: env.OFFGRID_VICTORIAMETRICS_URL,
    description:
      'Platform metrics (request/error rate, latency, service up) — PromQL/MetricsQL over the OTLP metrics stream. Read back on the Platform-health page.',
  },
  health: ping(env.OFFGRID_VICTORIAMETRICS_URL, '/health'),
};

export const victoriaLogsEntry: RegEntry = {
  meta: {
    id: 'victorialogs',
    capability: 'observability',
    vendor: 'VictoriaLogs',
    license: 'Apache-2.0',
    render: 'headless',
    embedUrl: env.OFFGRID_VICTORIALOGS_URL,
    description:
      'Platform logs — LogsQL search over the OTLP/log-shipper stream. Searchable on the Platform-health page.',
  },
  health: ping(env.OFFGRID_VICTORIALOGS_URL, '/health'),
};

export const jaegerEntry: RegEntry = {
  meta: {
    id: 'jaeger',
    capability: 'observability',
    vendor: 'Jaeger',
    license: 'Apache-2.0',
    render: 'embed',
    embedUrl: env.OFFGRID_JAEGER_WEB_URL ?? env.OFFGRID_JAEGER_URL,
    description:
      'Distributed traces — services + recent traces read back into the console, deep-linking to the Jaeger UI for the full waterfall.',
  },
  health: ping(env.OFFGRID_JAEGER_URL, '/'),
};

// LiteLLM Proxy — the router / load-balancer / budget layer on the model-door path (behind the
// gateway's GATEWAY_URL seam, OpenAI-compatible, replacing the hand-rolled aggregator). Surfaced in
// Integrations with live health, exactly like the other observability backends. Its /health/liveliness
// endpoint answers ok when the proxy is up; unset OFFGRID_LITELLM_URL ⇒ not connected (honest).
export const litellmEntry: RegEntry = {
  meta: {
    id: 'litellm',
    capability: 'observability',
    vendor: 'LiteLLM Proxy',
    license: 'MIT',
    render: 'headless',
    embedUrl: env.OFFGRID_LITELLM_URL,
    description:
      'Model router / load-balancer / budget layer on the gateway door — health-checked LB + automatic failover across the fleet and cloud, per-key budgets and rate limits, and structured request logging into the traffic index. Surfaced in the gateway Router view. Configure OFFGRID_LITELLM_URL + OFFGRID_LITELLM_MASTER_KEY.',
  },
  health: ping(env.OFFGRID_LITELLM_URL, '/health/liveliness'),
};
