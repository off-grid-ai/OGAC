import { randomBytes } from 'node:crypto';

// OpenTelemetry emission seam. When OFFGRID_OTLP_URL is set (e.g. the OTel Collector from
// deploy/docker-compose.yml), spans are exported as real OTLP/HTTP JSON — one wire, any backend
// (VictoriaMetrics / SigNoz / Langfuse) ingests it. With no URL it stays a no-op (OTEL_DEBUG echoes).
type SpanAttrs = Record<string, string | number | boolean | undefined>;

const OTLP_URL = process.env.OFFGRID_OTLP_URL;
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
