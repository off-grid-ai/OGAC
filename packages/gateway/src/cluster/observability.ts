// Plug-and-play observability for the cluster gateway.
//
// Every proxied call becomes a TrafficRecord. Where those records GO is
// pluggable: the gateway keeps its own in-memory rolling log (for health +
// the live /traffic view) and additionally fans each record out to any number
// of ObservabilitySink adapters. Built-ins ship for OpenSearch, Langfuse, and
// stdout; a host can pass its own sink (e.g. ClickHouse, a file, a webhook)
// without touching the gateway core. All sinks are fire-and-forget — a slow or
// broken sink can never block or fail a request.
import type { TrafficRecord } from './types';

export interface ObservabilitySink {
  /** Adapter name (for logs/introspection). */
  readonly name: string;
  /** Handle one captured call. MUST NOT throw; SHOULD NOT block the caller. */
  record(e: TrafficRecord): void;
}

/** Durable, SIEM-searchable logging: index each call into an OpenSearch document. */
export function openSearchSink(url: string, index = 'offgrid-gateway'): ObservabilitySink {
  return {
    name: `opensearch(${index})`,
    record(e) {
      try {
        void fetch(`${url}/${index}/_doc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ '@timestamp': new Date(e.ts).toISOString(), source: 'offgrid-gateway-cluster', ...e }),
        }).catch(() => {});
      } catch {
        /* fire-and-forget */
      }
    },
  };
}

/** LLM-native tracing: push a trace+generation per call to a Langfuse ingestion endpoint. */
export function langfuseSink(baseUrl: string, publicKey: string, secretKey: string): ObservabilitySink {
  const auth = 'Basic ' + Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
  return {
    name: 'langfuse',
    record(e) {
      try {
        const iso = new Date(e.ts).toISOString();
        const id = `${e.gateway}-${e.ts}`;
        void fetch(`${baseUrl}/api/public/ingestion`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: auth },
          body: JSON.stringify({
            batch: [
              { id: `t-${id}`, type: 'trace-create', timestamp: iso, body: { id: `trace-${id}`, name: `gateway:${e.kind}`, metadata: { gateway: e.gateway, corrId: e.corrId } } },
              {
                id: `g-${id}`,
                type: 'generation-create',
                timestamp: iso,
                body: {
                  traceId: `trace-${id}`,
                  name: e.model,
                  model: e.modelServed ?? e.model,
                  input: e.input,
                  output: e.output,
                  usage: { input: e.promptTokens, output: e.completionTokens, total: e.tokens },
                  metadata: { gateway: e.gateway, tps: e.tps, finish: e.finish, ms: e.ms },
                },
              },
            ],
          }),
        }).catch(() => {});
      } catch {
        /* fire-and-forget */
      }
    },
  };
}

/** One-line-per-call stdout logging (always useful; the default when nothing else is configured). */
export function stdoutSink(): ObservabilitySink {
  return {
    name: 'stdout',
    record(e) {
      // eslint-disable-next-line no-console
      console.log(
        `[req] ${new Date(e.ts).toISOString()} ${e.gateway} ${e.model} ${e.kind} ${e.status} ${e.ms}ms ${e.bytes}b${e.tokens ? ` tok=${e.tokens}` : ''}`,
      );
    },
  };
}

/** Build the default sink set from env (OpenSearch + Langfuse if configured, always stdout). */
export function sinksFromEnv(): ObservabilitySink[] {
  const sinks: ObservabilitySink[] = [stdoutSink()];
  const os = process.env.OFFGRID_OPENSEARCH_URL;
  if (os) sinks.push(openSearchSink(os, process.env.OFFGRID_GATEWAY_INDEX || 'offgrid-gateway'));
  const lf = process.env.OFFGRID_LANGFUSE_URL;
  const pk = process.env.OFFGRID_LANGFUSE_PUBLIC_KEY;
  const sk = process.env.OFFGRID_LANGFUSE_SECRET_KEY;
  if (lf && pk && sk) sinks.push(langfuseSink(lf, pk, sk));
  return sinks;
}
