// src/store.ts
var DEFAULT_MAX_RECORDS = 1e4;
function emptyAcc() {
  return { requests: 0, errors: 0, tokens: 0, msSum: 0 };
}
function accToRow(key, a) {
  return {
    model: key,
    requests: a.requests,
    tokens: a.tokens,
    avgMs: a.requests ? a.msSum / a.requests : 0,
    errorRate: a.requests ? a.errors / a.requests : 0
  };
}
function rowsSortedByRequests(map) {
  return [...map.entries()].map(([k, a]) => accToRow(k, a)).sort((x, y) => y.requests - x.requests);
}
var AnalyticsStore = class {
  maxRecords;
  /** Ring buffer of recent records (bounded by maxRecords). */
  buf = [];
  /** Write cursor into `buf` once it has reached capacity. */
  head = 0;
  // Pre-aggregated global counters (never evicted).
  requests = 0;
  errors = 0;
  tokens = 0;
  promptTokens = 0;
  completionTokens = 0;
  msSum = 0;
  tpsSum = 0;
  tpsCount = 0;
  // Pre-aggregated group counters (never evicted).
  models = /* @__PURE__ */ new Map();
  callers = /* @__PURE__ */ new Map();
  gateways = /* @__PURE__ */ new Map();
  constructor(opts = {}) {
    this.maxRecords = Math.max(1, opts.maxRecords ?? DEFAULT_MAX_RECORDS);
  }
  /** Ingest one completed traffic record. Never throws. */
  ingest(e) {
    if (this.buf.length < this.maxRecords) {
      this.buf.push(e);
    } else {
      this.buf[this.head] = e;
      this.head = (this.head + 1) % this.maxRecords;
    }
    const isErr = e.status >= 400;
    this.requests += 1;
    if (isErr) this.errors += 1;
    this.tokens += e.tokens || 0;
    this.promptTokens += e.promptTokens ?? 0;
    this.completionTokens += e.completionTokens ?? 0;
    this.msSum += e.ms || 0;
    if (typeof e.tps === "number" && e.tps > 0) {
      this.tpsSum += e.tps;
      this.tpsCount += 1;
    }
    this.bump(this.models, e.modelServed || e.model || "unknown", e, isErr);
    this.bump(this.callers, e.caller || "unknown", e, isErr);
    this.bump(this.gateways, e.gateway || "unknown", e, isErr);
  }
  bump(map, key, e, isErr) {
    let a = map.get(key);
    if (!a) {
      a = emptyAcc();
      map.set(key, a);
    }
    a.requests += 1;
    if (isErr) a.errors += 1;
    a.tokens += e.tokens || 0;
    a.msSum += e.ms || 0;
  }
  totals() {
    return {
      requests: this.requests,
      errors: this.errors,
      errorRate: this.requests ? this.errors / this.requests : 0,
      tokens: this.tokens,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      avgMs: this.requests ? this.msSum / this.requests : 0,
      avgTps: this.tpsCount ? this.tpsSum / this.tpsCount : 0
    };
  }
  byModel() {
    return rowsSortedByRequests(this.models);
  }
  byCaller() {
    return rowsSortedByRequests(this.callers);
  }
  byGateway() {
    return rowsSortedByRequests(this.gateways);
  }
  /**
   * Bucketed timeseries built from the retained ring buffer.
   * @param bucketMs bucket width in ms
   * @param sinceMs  optional lower bound (epoch ms); records older are ignored
   */
  timeseries(bucketMs, sinceMs) {
    const width = Math.max(1, Math.floor(bucketMs));
    const buckets = /* @__PURE__ */ new Map();
    for (const e of this.buf) {
      if (sinceMs !== void 0 && e.ts < sinceMs) continue;
      const t = Math.floor(e.ts / width) * width;
      let b = buckets.get(t);
      if (!b) {
        b = { t, requests: 0, tokens: 0, errors: 0, avgMs: 0, msSum: 0 };
        buckets.set(t, b);
      }
      b.requests += 1;
      b.tokens += e.tokens || 0;
      if (e.status >= 400) b.errors += 1;
      b.msSum += e.ms || 0;
    }
    return [...buckets.values()].sort((a, b) => a.t - b.t).map(({ msSum, ...rest }) => ({
      ...rest,
      avgMs: rest.requests ? msSum / rest.requests : 0
    }));
  }
  /**
   * Best-effort: most frequent recent distinct inputs from the ring buffer.
   * Only records that carried an `input` are considered.
   */
  topPrompts(n = 10) {
    const counts = /* @__PURE__ */ new Map();
    for (const e of this.buf) {
      const input = e.input;
      if (!input) continue;
      const c = counts.get(input);
      if (c) {
        c.count += 1;
        if (e.ts > c.lastTs) c.lastTs = e.ts;
      } else {
        counts.set(input, { input, count: 1, lastTs: e.ts });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || b.lastTs - a.lastTs).slice(0, Math.max(0, n));
  }
};

// src/sinks.ts
function analyticsSink(store) {
  return {
    name: "analytics",
    record: (e) => store.ingest(e)
  };
}
function firePost(url, body, headers) {
  try {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers ?? {} },
      body: JSON.stringify(body)
    }).catch(() => {
    });
  } catch {
  }
}
function eventProps(e) {
  return {
    $ai_model: e.model,
    $ai_model_served: e.modelServed ?? e.model,
    $ai_provider: "offgrid-gateway",
    $ai_gateway: e.gateway,
    $ai_kind: e.kind,
    $ai_http_status: e.status,
    $ai_is_error: e.status >= 400,
    $ai_latency: e.ms,
    $ai_latency_ms: e.ms,
    $ai_bytes: e.bytes,
    $ai_input_tokens: e.promptTokens ?? void 0,
    $ai_output_tokens: e.completionTokens ?? void 0,
    $ai_total_tokens: e.tokens,
    $ai_tps: e.tps,
    $ai_finish_reason: e.finish,
    $ai_temperature: e.params?.temperature,
    $ai_max_tokens: e.params?.maxTokens,
    $ai_tools_offered: e.params?.toolsOffered,
    corr_id: e.corrId,
    timestamp: new Date(e.ts).toISOString()
  };
}
function posthogSink(apiKey, host) {
  const base = (host || "https://app.posthog.com").replace(/\/+$/, "");
  const url = `${base}/capture/`;
  return {
    name: "posthog",
    record: (e) => {
      firePost(url, {
        api_key: apiKey,
        event: "$ai_generation",
        distinct_id: e.caller || e.gateway || "offgrid-gateway",
        timestamp: new Date(e.ts).toISOString(),
        properties: eventProps(e)
      });
    }
  };
}
function mixpanelSink(token) {
  const url = "https://api.mixpanel.com/track";
  return {
    name: "mixpanel",
    record: (e) => {
      const payload = [
        {
          event: "ai_generation",
          properties: {
            token,
            time: e.ts,
            distinct_id: e.caller || e.gateway || "offgrid-gateway",
            $insert_id: e.corrId || `${e.gateway}-${e.ts}`,
            ...eventProps(e)
          }
        }
      ];
      const data = toBase64(JSON.stringify(payload));
      firePost(url, { data }, { "content-type": "application/json" });
    }
  };
}
function webhookSink(url) {
  return {
    name: "webhook",
    record: (e) => {
      firePost(url, e);
    }
  };
}
function toBase64(s) {
  const g = globalThis;
  const buf = globalThis.Buffer;
  if (buf) return buf.from(s, "utf-8").toString("base64");
  if (typeof g.btoa === "function") {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return g.btoa(bin);
  }
  return s;
}

// src/integrations.ts
var ANALYTICS_INTEGRATIONS = [
  { id: "posthog", name: "PostHog", category: "analytics", configFields: ["apiKey", "host"] },
  { id: "mixpanel", name: "Mixpanel", category: "analytics", configFields: ["token"] },
  { id: "webhook", name: "Webhook", category: "analytics", configFields: ["url"] },
  { id: "builtin", name: "Built-in analytics store", category: "analytics" }
];
export {
  ANALYTICS_INTEGRATIONS,
  AnalyticsStore,
  analyticsSink,
  mixpanelSink,
  posthogSink,
  webhookSink
};
