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
      vendor: 'Off Grid RBAC + ABAC',
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
      description: 'Policy-as-code (Rego) decision API for complex authorization.',
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

export const GUARDRAIL_ENTRIES: RegEntry[] = [
  {
    meta: {
      id: 'checks',
      capability: 'guardrails',
      vendor: 'Off Grid checks spine',
      license: 'first-party',
      render: 'native',
      description: 'PII / injection hooks normalized onto the audit record (always on).',
    },
  },
  {
    meta: {
      id: 'presidio',
      capability: 'guardrails',
      vendor: 'Microsoft Presidio',
      license: 'MIT',
      render: 'headless',
      embedUrl: env.OFFGRID_PRESIDIO_URL,
      description: 'Production-grade PII detection / anonymization behind the checks port.',
    },
    health: ping(env.OFFGRID_PRESIDIO_URL, '/health'),
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

export const CACHING: RegEntry[] = [
  {
    meta: {
      id: 'memory',
      capability: 'caching',
      vendor: 'Off Grid in-process cache',
      license: 'first-party',
      render: 'native',
      description: 'Exact-match response cache in the gateway (default).',
    },
  },
  {
    meta: {
      id: 'redis',
      capability: 'caching',
      vendor: 'Redis',
      license: 'BSD-3-Clause',
      render: 'headless',
      embedUrl: env.OFFGRID_REDIS_URL,
      description: 'Exact + semantic response cache and rate limiting at scale.',
    },
  },
];

export const SIEM: RegEntry[] = [
  {
    meta: {
      id: 'audit',
      capability: 'siem',
      vendor: 'Off Grid audit store',
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

export const FLAGS: RegEntry[] = [
  {
    meta: {
      id: 'native',
      capability: 'flags',
      vendor: 'Off Grid flags',
      license: 'first-party',
      render: 'native',
      description: 'Module/capability enablement via env + per-tenant config (default).',
    },
  },
  {
    meta: {
      id: 'unleash',
      capability: 'flags',
      vendor: 'Unleash',
      license: 'Apache-2.0',
      render: 'embed',
      embedUrl: env.OFFGRID_UNLEASH_URL,
      description: 'Feature-flag service — the backbone of modular control at scale.',
    },
    health: ping(env.OFFGRID_UNLEASH_URL, '/health'),
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
      vendor: 'Off Grid provenance chain',
      license: 'first-party',
      render: 'native',
      description:
        'Every answer carries source refs (router) + verified citations (grounding), recorded on the run/audit trace. Always on.',
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
        'Cryptographically sign answers/exports with their source chain — tamper-evident, offline-verifiable (c2pa-node).',
    },
  },
  {
    meta: {
      id: 'sigstore',
      capability: 'provenance',
      vendor: 'Sigstore',
      license: 'Apache-2.0',
      render: 'headless',
      description: 'Keyless signing / attestation of artifacts and exports.',
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
// only through the registered, scoped tool registry — arbitrary code is refused). E2B / Firecracker
// give real isolation when agents must run untrusted code; Falco adds runtime threat detection.
export const SANDBOX: RegEntry[] = [
  {
    meta: {
      id: 'none',
      capability: 'sandbox',
      vendor: 'Off Grid (no-exec)',
      license: 'first-party',
      render: 'native',
      description:
        'No arbitrary code execution; tools run only via the scoped registry. Safe default.',
    },
  },
  {
    meta: {
      id: 'e2b',
      capability: 'sandbox',
      vendor: 'E2B',
      license: 'Apache-2.0',
      render: 'headless',
      embedUrl: env.OFFGRID_E2B_URL,
      description: 'Cloud sandboxes for agent code execution (firecracker microVMs).',
    },
  },
  {
    meta: {
      id: 'firecracker',
      capability: 'sandbox',
      vendor: 'Firecracker',
      license: 'Apache-2.0',
      render: 'headless',
      description: 'Self-hosted microVM isolation for untrusted tool/code execution.',
    },
  },
  {
    meta: {
      id: 'falco',
      capability: 'sandbox',
      vendor: 'Falco',
      license: 'Apache-2.0',
      render: 'headless',
      description: 'Runtime threat detection on the execution host (syscall anomalies).',
    },
  },
];

// Evals. Default is the first-party golden-set (recall over the Brain). promptfoo (Node) adds an
// assertion matrix across providers; Ragas/DeepEval (Python service) add RAG metrics — faithfulness,
// context precision/recall, answer relevancy. All run offline against recorded outputs.
export const EVALS: RegEntry[] = [
  {
    meta: {
      id: 'golden',
      capability: 'evals',
      vendor: 'Off Grid golden set',
      license: 'first-party',
      render: 'native',
      description: 'Recall-scored golden query→expected-doc set over the Brain (always on).',
    },
  },
  {
    meta: {
      id: 'promptfoo',
      capability: 'evals',
      vendor: 'promptfoo',
      license: 'MIT',
      render: 'headless',
      description: 'Assertion-matrix evals across providers (Node-native).',
    },
  },
  {
    meta: {
      id: 'ragas',
      capability: 'evals',
      vendor: 'Ragas + DeepEval',
      license: 'Apache-2.0',
      render: 'headless',
      embedUrl: env.OFFGRID_RAGAS_URL,
      description: 'RAG metrics — faithfulness, context precision/recall, answer relevancy.',
    },
  },
];

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
