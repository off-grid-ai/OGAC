// PURE exporter contracts — zero imports, zero I/O, fully unit-testable.
//
// M6 ("good citizen"): the platform must EXPORT the spine to the enterprise's own tooling
// (SIEM / catalog / observability), not be an island. IdP federation (Keycloak) already exists;
// this adds the spine EXPORTERS.
//
// The framework is deliberately tiny and pluggable: an `Exporter` knows its `kind` (which slice of
// the spine it emits — audit / lineage / metrics), can `test()` its configured endpoint, and can
// `export(records)`. Concrete exporters (Splunk HEC, OpenLineage, Prometheus/OTLP) live beside this
// file. Everything a concrete exporter needs to DECIDE (payload shape, URL, auth header) is pure and
// tested here + in the per-exporter payload builders; the network call is the only I/O, isolated in
// the thin `run.ts` adapter.
//
// SAFETY INVARIANT: a target NEVER stores a raw token. It stores a `secretRef` (an OpenBao key
// path); the token is resolved at export time through the existing secret path. This mirrors how
// service-credentials.ts brokers every other outbound credential.

// ── The three spine slices an exporter can emit ────────────────────────────────────────────────
export type ExporterKind = 'audit' | 'lineage' | 'metrics';

export const EXPORTER_KINDS: readonly ExporterKind[] = ['audit', 'lineage', 'metrics'];

export function isExporterKind(v: unknown): v is ExporterKind {
  return typeof v === 'string' && (EXPORTER_KINDS as readonly string[]).includes(v);
}

// The concrete implementation each kind maps to (one standards-based target per kind for now).
// `audit` → Splunk HEC, `lineage` → OpenLineage consumer (Purview/Collibra/Marquez), `metrics` →
// Prometheus scrape / OTLP push. Kept as data so the config layer + UI can enumerate choices.
export interface ExporterCatalogEntry {
  kind: ExporterKind;
  id: string; // stable exporter id (e.g. 'splunk-hec')
  label: string; // human label for the UI
  target: string; // the enterprise tool this speaks to
  // whether an endpoint URL is required to be configured (metrics-scrape needs none)
  endpointRequired: boolean;
  // whether a secret (token) is required (Prometheus scrape is pull-based, no push token)
  secretRequired: boolean;
}

export const EXPORTER_CATALOG: readonly ExporterCatalogEntry[] = [
  {
    kind: 'audit',
    id: 'splunk-hec',
    label: 'Splunk (HEC)',
    target: 'Splunk HTTP Event Collector',
    endpointRequired: true,
    secretRequired: true,
  },
  {
    kind: 'lineage',
    id: 'openlineage',
    label: 'OpenLineage',
    target: 'Purview / Collibra / Marquez (any OpenLineage consumer)',
    endpointRequired: true,
    secretRequired: false, // many OpenLineage endpoints are unauthenticated / mTLS at the edge
  },
  {
    kind: 'metrics',
    id: 'prometheus-otlp',
    label: 'Prometheus / OTLP',
    target: 'Grafana / Prometheus / OTLP collector',
    endpointRequired: false, // scrape mode needs no endpoint; push (OTLP) does — validated below
    secretRequired: false,
  },
];

export function catalogFor(kind: ExporterKind): ExporterCatalogEntry | undefined {
  return EXPORTER_CATALOG.find((e) => e.kind === kind);
}

// ── The Exporter interface (implemented by the concrete exporters) ─────────────────────────────
// A network probe result — the honest last-status the UI shows. `ok` is the real outcome of the
// call; `detail` is a short human string (status code / error). Never invents success.
export interface ProbeResult {
  ok: boolean;
  detail: string;
}

// The result of an export run — how many records were accepted vs the call outcome.
export interface ExportResult {
  ok: boolean;
  count: number; // records attempted
  detail: string;
}

// Resolved config an exporter runs against. `secret` is the RESOLVED token (from the secret path),
// injected at call time — it is never persisted on the target row.
export interface ResolvedTarget {
  id: string;
  kind: ExporterKind;
  endpoint: string;
  secret: string | null; // resolved token, or null when the target needs none
}

// A minimal fetch signature so exporters can be unit-tested with a fake fetch (no real Splunk).
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

// A record the exporter serializes. The three kinds carry different payloads; a concrete exporter
// only ever receives records of its own kind (the run adapter routes by kind).
export interface Exporter<TRecord = unknown> {
  id: string;
  kind: ExporterKind;
  // Probe the endpoint (real network) — ok/fail with a human detail. Pure builders decide the
  // request; the adapter performs the fetch.
  test(target: ResolvedTarget, fetchImpl: FetchLike): Promise<ProbeResult>;
  // Ship `records` to the endpoint. Returns the honest outcome.
  export(target: ResolvedTarget, records: TRecord[], fetchImpl: FetchLike): Promise<ExportResult>;
}
