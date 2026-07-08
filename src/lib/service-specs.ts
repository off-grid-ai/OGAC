// PURE catalog for the unified API-spec browser (Phase 5) — ZERO I/O, so it's unit-testable. Maps
// each integrated service to where its OpenAPI spec lives: the console's own generated spec, a
// native spec on the service (fetched server-side through /api/v1/specs/<id> to dodge CORS + reach
// LAN-only hosts), or a hand-authored note for services with no machine spec. The base URL comes
// from the same env var the service's adapter uses; an unset/unreachable service degrades to a
// clear "unavailable" in the browser rather than breaking the page.

export interface ServiceSpec {
  id: string;
  label: string;
  /** 'console' = our generated spec; 'native' = fetch from the service; 'stub' = no machine spec. */
  kind: 'console' | 'native' | 'stub';
  /** For native specs: the env var holding the service base URL + the spec path to append. */
  envVar?: string;
  specPath?: string;
  note?: string;
}

export const SERVICE_SPECS: ServiceSpec[] = [
  { id: 'console', label: 'Off Grid AI Console', kind: 'console' },
  { id: 'openbao', label: 'Secrets store', kind: 'native', envVar: 'OFFGRID_OPENBAO_URL', specPath: '/v1/sys/internal/specs/openapi' },
  { id: 'qdrant', label: 'Vector store', kind: 'native', envVar: 'OFFGRID_QDRANT_URL', specPath: '/openapi/openapi-3.1.0.json' },
  { id: 'marquez', label: 'Data lineage', kind: 'native', envVar: 'OFFGRID_MARQUEZ_URL', specPath: '/api/v1/openapi.json' },
  { id: 'langfuse', label: 'Tracing & observability', kind: 'native', envVar: 'OFFGRID_LANGFUSE_URL', specPath: '/api/public/openapi.json' },
  { id: 'superset', label: 'Dashboards & BI', kind: 'native', envVar: 'OFFGRID_SUPERSET_URL', specPath: '/api/v1/openapi.json' },
  { id: 'fleetdm', label: 'Device management', kind: 'native', envVar: 'OFFGRID_FLEET_URL', specPath: '/api/openapi.json' },
  { id: 'presidio', label: 'PII detection', kind: 'native', envVar: 'OFFGRID_PRESIDIO_URL', specPath: '/openapi.json' },
  { id: 'unleash', label: 'Feature flags', kind: 'native', envVar: 'OFFGRID_UNLEASH_URL', specPath: '/api/swagger.json' },
  { id: 'keycloak', label: 'Identity provider', kind: 'stub', note: 'The identity provider has no machine-readable OpenAPI spec — see its admin REST docs.' },
  { id: 'opa', label: 'Policy engine', kind: 'stub', note: 'The policy engine exposes a Data/Policy REST API; no OpenAPI document is published.' },
  { id: 'temporal', label: 'Workflow engine', kind: 'stub', note: 'The workflow engine is gRPC-first; no REST OpenAPI spec.' },
];

export function getServiceSpec(id: string): ServiceSpec | undefined {
  return SERVICE_SPECS.find((s) => s.id === id);
}

/** Resolve a native service's full spec URL from env, or null if unset/not native. */
export function resolveSpecUrl(
  spec: ServiceSpec,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (spec.kind !== 'native' || !spec.envVar || !spec.specPath) return null;
  const base = env[spec.envVar]?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}${spec.specPath}`;
}
