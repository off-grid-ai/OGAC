import { randomBytes } from 'node:crypto';
import { resolveOtelConfig } from '@/lib/otel-config';

// OpenTelemetry emission seam. When OFFGRID_OTLP_URL is set (e.g. the OTel Collector from
// deploy/docker-compose.yml), spans are exported as real OTLP/HTTP JSON — one wire, any backend
// (VictoriaMetrics / SigNoz / Langfuse) ingests it. With no URL it stays a no-op (OTEL_DEBUG echoes).
type SpanAttrs = Record<string, string | number | boolean | undefined>;

const OTLP_URL = resolveOtelConfig().baseUrl;
// Langfuse ingests OTLP traces directly (Basic-auth with its key pair). Setting these turns the
// same span stream into LLM traces in Langfuse — no separate SDK, just a second OTLP target.
const LANGFUSE_OTLP_URL = process.env.OFFGRID_LANGFUSE_OTLP_URL;
const LANGFUSE_AUTH = process.env.OFFGRID_LANGFUSE_AUTH; // base64 of "public-key:secret-key"

interface SpanTarget {
  url: string;
  headers: Record<string, string>;
}

function targets(): SpanTarget[] {
  const out: SpanTarget[] = [];
  if (OTLP_URL) out.push({ url: `${OTLP_URL}/v1/traces`, headers: {} });
  if (LANGFUSE_OTLP_URL && LANGFUSE_AUTH) {
    out.push({
      url: `${LANGFUSE_OTLP_URL}/v1/traces`,
      headers: { authorization: `Basic ${LANGFUSE_AUTH}` },
    });
  }
  return out;
}

function anyValue(v: string | number | boolean): Record<string, unknown> {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
  return { stringValue: v };
}

function toAttributes(attrs: SpanAttrs): { key: string; value: Record<string, unknown> }[] {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => ({ key, value: anyValue(v as string | number | boolean) }));
}

function exportSpan(name: string, attrs: SpanAttrs): void {
  const now = `${Date.now()}000000`;
  const body = {
    resourceSpans: [
      {
        resource: { attributes: toAttributes({ 'service.name': 'offgrid-console' }) },
        scopeSpans: [
          {
            scope: { name: 'offgrid-console' },
            spans: [
              {
                traceId: randomBytes(16).toString('hex'),
                spanId: randomBytes(8).toString('hex'),
                name,
                kind: 1,
                startTimeUnixNano: now,
                endTimeUnixNano: now,
                attributes: toAttributes(attrs),
              },
            ],
          },
        ],
      },
    ],
  };
  // Fire-and-forget to every configured target — observability must never block the request path.
  const payload = JSON.stringify(body);
  for (const t of targets()) {
    fetch(t.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.headers },
      body: payload,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
}

export function emitSpan(name: string, attrs: SpanAttrs): void {
  if (process.env.OTEL_DEBUG === 'true') {
    process.stdout.write(`[otel] ${name} ${JSON.stringify(attrs)}\n`);
  }
  if (targets().length > 0) exportSpan(name, attrs);
}

// ─── Metrics ────────────────────────────────────────────────────────────────────────────────────────
//
// The capability map: "OTLP metrics and remote write — add a recurring application metric producer and
// correlate accepted/exported sample counts", with the workflow gate at `no` because "the fleet reports
// zero application series". Verified 2026-08-04: VictoriaMetrics answers
// /api/v1/label/__name__/values with `data: []` — reachable and genuinely empty. The collector's metrics
// pipeline was wired and nothing was ever produced into it.
//
// Same OTLP/HTTP wire as spans, different signal path (/v1/metrics). Deliberately only two primitives —
// a counter and a gauge — because an application metric nobody reads is cost, and these two cover
// "how often did X happen" and "what is X now", which is what the operational alerts need.

/** A gauge sample: the value as of now. */
export function emitGauge(name: string, value: number, attrs: SpanAttrs = {}): void {
  emitMetric(name, value, attrs, 'gauge');
}

/** A counter sample: monotonically increasing total. */
export function emitCounter(name: string, value: number, attrs: SpanAttrs = {}): void {
  emitMetric(name, value, attrs, 'sum');
}

function metricTargets(): SpanTarget[] {
  // Langfuse ingests traces, not metrics — sending it a metrics envelope would be a guaranteed 4xx on
  // every emit, so the metric path targets the collector only.
  return OTLP_URL ? [{ url: `${OTLP_URL}/v1/metrics`, headers: {} }] : [];
}

function emitMetric(name: string, value: number, attrs: SpanAttrs, kind: 'gauge' | 'sum'): void {
  if (process.env.OTEL_DEBUG === 'true') {
    process.stdout.write(`[otel] ${kind} ${name}=${value} ${JSON.stringify(attrs)}\n`);
  }
  const tgts = metricTargets();
  if (tgts.length === 0) return;

  const now = `${Date.now() * 1_000_000}`;
  const point = {
    asDouble: value,
    timeUnixNano: now,
    startTimeUnixNano: now,
    attributes: toAttributes(attrs),
  };
  const body = {
    resourceMetrics: [
      {
        resource: { attributes: toAttributes({ 'service.name': 'offgrid-console' }) },
        scopeMetrics: [
          {
            scope: { name: 'offgrid.console' },
            metrics: [
              {
                name,
                ...(kind === 'gauge'
                  ? { gauge: { dataPoints: [point] } }
                  : // aggregationTemporality 2 = CUMULATIVE, isMonotonic true — what a counter means, and
                    // what VictoriaMetrics needs to treat it as a counter rather than an arbitrary series.
                    { sum: { dataPoints: [point], aggregationTemporality: 2, isMonotonic: true } }),
              },
            ],
          },
        ],
      },
    ],
  };
  const payload = JSON.stringify(body);
  for (const t of tgts) {
    // Fire-and-forget, exactly like spans: observability must never block or fail the request path.
    fetch(t.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.headers },
      body: payload,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
}
