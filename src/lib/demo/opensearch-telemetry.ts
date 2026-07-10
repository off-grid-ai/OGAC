// PURE mapper: a demo RunMetric → the EXACT OpenSearch `offgrid-gateway` document the analytics
// readers aggregate on. ZERO I/O, fully deterministic, unit-testable. The `.mts` seed script is the
// thin adapter that bulk-indexes what this returns.
//
// WHY this shape: the durable gateway log doc is whatever the aggregator writes —
//   scripts/gateway-aggregator.mjs:232  → { '@timestamp': ISO(ts), source, ...TrafficRecord }
// and the READERS aggregate on those field names:
//   • src/lib/analytics-aggs.ts:48–82 — `tokens` (sum), `ms` (latency percentiles/sum),
//     `status` (>=400 ⇒ blocked), `model.keyword` (byModel terms), `@timestamp` (day histogram +
//     recent/baseline drift & perf split), `project.keyword` (pipeline narrowing).
//   • src/lib/analytics.ts:39–53 — per-doc read of `caller`/`gateway`, `@timestamp`/`ts`, `model`,
//     `tokens`, `status`, `ms`.
//   • src/lib/finops.ts — prices `tokens` × `model`, buckets days by `@timestamp` (ts.slice(0,10)).
//   • src/app/api/v1/gateway/analytics|logs — replay each `_source` as an @offgrid/analytics
//     TrafficRecord ({ ts, gateway, model, kind, status, ms, bytes, tokens, ... }).
// So we mirror TrafficRecord + the aggregator's `@timestamp`/`source` envelope EXACTLY, and add the
// tenant `org` tag so each tenant's charts stay isolated. We do NOT fork the record type — we build
// the same field names the readers already consume (DRY with the gateway write path).
//
// Cost note: TrafficRecord has no cost field (finops derives cost from tokens×model). We still carry
// the corpus `costUsd`/`evalScore`/`guardrailVerdict`/`outcome`/`appKey` as extra fields — harmless
// to the readers (they ignore unknown fields) and available to any future org-scoped reader.
import type { RunMetric } from '@/lib/demo/telemetry';

/** The tenant orgs this demo telemetry is allowed to target — the isolation allow-list. */
export const DEMO_TELEMETRY_ORGS = ['org_bharat', 'org_suraksha'] as const;
export type DemoTelemetryOrg = (typeof DEMO_TELEMETRY_ORGS)[number];

/** A gateway status only distinguishes ok (200) from blocked (403). The analytics blocked-rate is a
 * `status >= 400` range filter, so a guardrail-blocked run must land as a 4xx to be counted. */
const STATUS_OK = 200;
const STATUS_BLOCKED = 403;

/**
 * The OpenSearch `offgrid-gateway` document for one demo run — byte-shaped like a real gateway log
 * record (@timestamp + source + the TrafficRecord fields the readers aggregate on), tagged with the
 * tenant `org`. PURE. Unknown-to-readers fields (org/cost/eval/verdict/appKey) ride along harmlessly.
 */
export interface GatewayTelemetryDoc {
  /** ISO timestamp — the field the day-histogram / drift / perf splits aggregate on. */
  '@timestamp': string;
  /** Epoch ms — the per-doc fallback the analytics raw-read + FinOps use. */
  ts: number;
  /** Marks these as demo-seeded (mirrors the aggregator's `source:'gateway-aggregator'`). */
  source: 'demo-seed';
  /** The tenant org — the isolation tag so each tenant's charts stay separate. */
  org: DemoTelemetryOrg;
  /** Logical node/model that served the run (byGateway attribution). */
  gateway: string;
  /** Requested model — byModel terms agg reads `model.keyword`. */
  model: string;
  /** High-level workload kind (TrafficRecord parity). */
  kind: 'text';
  /** HTTP-style status: 200 ok, 403 blocked (the >=400 blocked-rate filter). */
  status: number;
  /** End-to-end latency ms — the percentile/sum field. */
  ms: number;
  /** Payload size bytes (best effort; 0 for demo). */
  bytes: number;
  /** Total tokens — the sum field FinOps/analytics roll up. */
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Pipeline/use-case attribution — readers narrow on `project.keyword`. */
  project: string;
  /** Calling identity (byCaller attribution). */
  caller: string;
  /** Correlation id — the run id, so a doc traces back to the run. */
  corrId: string;
  // ── extra demo fields (readers ignore unknowns; available to org-scoped readers) ──
  costUsd: number;
  evalScore: number;
  guardrailVerdict: RunMetric['guardrailVerdict'];
  outcome: RunMetric['outcome'];
  appKey: string;
}

/**
 * Map ONE RunMetric → its gateway telemetry doc for a given tenant org. Deterministic: the doc id is
 * the RunMetric.id (already `run_<hash12>` seeded per org/app/index), so a re-run upserts the SAME id.
 */
export function runMetricToGatewayDoc(org: DemoTelemetryOrg, m: RunMetric): GatewayTelemetryDoc {
  return {
    '@timestamp': m.ts,
    ts: Date.parse(m.ts),
    source: 'demo-seed',
    org,
    gateway: m.model,
    model: m.model,
    kind: 'text',
    status: m.outcome === 'blocked' ? STATUS_BLOCKED : STATUS_OK,
    ms: m.latencyMs,
    bytes: 0,
    tokens: m.totalTokens,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    project: m.appTitle,
    caller: `${org}:${m.appKey}`,
    corrId: m.id,
    costUsd: m.costUsd,
    evalScore: m.evalScore,
    guardrailVerdict: m.guardrailVerdict,
    outcome: m.outcome,
    appKey: m.appKey,
  };
}

/** The deterministic OpenSearch `_id` for a run's doc — the run id, so re-runs UPSERT, never dup. */
export function docId(m: RunMetric): string {
  return m.id;
}

/**
 * Build the NDJSON body for an OpenSearch `_bulk` request from a tenant's corpus. Each doc is an
 * `index` action with an explicit deterministic `_id` (UPSERT semantics — a re-run overwrites the
 * same doc, never appends a duplicate). PURE — returns the string the adapter POSTs. Every emitted
 * doc carries `org`, so this can ONLY ever write docs for the given allow-listed tenant.
 */
export function buildBulkBody(
  index: string,
  org: DemoTelemetryOrg,
  corpus: readonly RunMetric[],
): string {
  const lines: string[] = [];
  for (const m of corpus) {
    lines.push(JSON.stringify({ index: { _index: index, _id: docId(m) } }));
    lines.push(JSON.stringify(runMetricToGatewayDoc(org, m)));
  }
  // A bulk body MUST end with a trailing newline.
  return lines.length ? lines.join('\n') + '\n' : '';
}
