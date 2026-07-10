// @offgrid/analytics — sinks
//
// ObservabilitySink implementations. All adapter sinks are fire-and-forget and
// fail-open: they never throw, never await on the request path, and swallow
// transport errors so a flaky analytics backend can never impact the gateway.

import type { AnalyticsStore } from './store.js';
import type { ObservabilitySink, TrafficRecord } from './gateway-types.js';

/** Sink that feeds records into the built-in in-memory AnalyticsStore. */
export function analyticsSink(store: AnalyticsStore): ObservabilitySink {
  return {
    name: 'analytics',
    record: (e: TrafficRecord) => store.ingest(e),
  };
}

/** Fire a POST without blocking; swallow any failure (fail-open). */
function firePost(url: string, body: unknown, headers?: Record<string, string>): void {
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(body),
    }).catch(() => {
      /* fail-open: analytics must never break the gateway */
    });
  } catch {
    /* fetch construction failed (e.g. bad url) — ignore */
  }
}

/** Common analytic properties derived from a traffic record. */
function eventProps(e: TrafficRecord): Record<string, unknown> {
  return {
    $ai_model: e.model,
    $ai_model_served: e.modelServed ?? e.model,
    $ai_provider: 'offgrid-gateway',
    $ai_gateway: e.gateway,
    $ai_kind: e.kind,
    $ai_http_status: e.status,
    $ai_is_error: e.status >= 400,
    $ai_latency: e.ms,
    $ai_latency_ms: e.ms,
    $ai_bytes: e.bytes,
    $ai_input_tokens: e.promptTokens ?? undefined,
    $ai_output_tokens: e.completionTokens ?? undefined,
    $ai_total_tokens: e.tokens,
    $ai_tps: e.tps,
    $ai_finish_reason: e.finish,
    $ai_temperature: e.params?.temperature,
    $ai_max_tokens: e.params?.maxTokens,
    $ai_tools_offered: e.params?.toolsOffered,
    corr_id: e.corrId,
    timestamp: new Date(e.ts).toISOString(),
  };
}

/**
 * PostHog adapter. Emits a `$ai_generation` LLM-analytics event per record via
 * the public capture endpoint.
 * @param host defaults to https://app.posthog.com
 */
export function posthogSink(apiKey: string, host?: string): ObservabilitySink {
  const base = (host || 'https://app.posthog.com').replace(/\/+$/, '');
  const url = `${base}/capture/`;
  return {
    name: 'posthog',
    record: (e: TrafficRecord) => {
      firePost(url, {
        api_key: apiKey,
        event: '$ai_generation',
        distinct_id: e.caller || e.gateway || 'offgrid-gateway',
        timestamp: new Date(e.ts).toISOString(),
        properties: eventProps(e),
      });
    },
  };
}

/**
 * Mixpanel adapter. Posts a base64-encoded `data` payload to the track API,
 * matching Mixpanel's classic form-style ingestion.
 */
export function mixpanelSink(token: string): ObservabilitySink {
  const url = 'https://api.mixpanel.com/track';
  return {
    name: 'mixpanel',
    record: (e: TrafficRecord) => {
      const payload = [
        {
          event: 'ai_generation',
          properties: {
            token,
            time: e.ts,
            distinct_id: e.caller || e.gateway || 'offgrid-gateway',
            $insert_id: e.corrId || `${e.gateway}-${e.ts}`,
            ...eventProps(e),
          },
        },
      ];
      const data = toBase64(JSON.stringify(payload));
      firePost(url, { data }, { 'content-type': 'application/json' });
    },
  };
}

/** POST each raw record as JSON to an arbitrary webhook URL. */
export function webhookSink(url: string): ObservabilitySink {
  return {
    name: 'webhook',
    record: (e: TrafficRecord) => {
      firePost(url, e);
    },
  };
}

/** Base64-encode a UTF-8 string across Node and browser/edge runtimes. */
function toBase64(s: string): string {
  const g = globalThis as { btoa?: (v: string) => string };
  // Prefer Node's Buffer when present (handles UTF-8 correctly).
  const buf = (globalThis as { Buffer?: { from(v: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (buf) return buf.from(s, 'utf-8').toString('base64');
  if (typeof g.btoa === 'function') {
    // btoa is latin1; round-trip UTF-8 bytes through it.
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return g.btoa(bin);
  }
  return s;
}
