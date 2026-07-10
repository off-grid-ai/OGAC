// src/pricing.ts
var LOCAL_MODEL_COST = 2e-5;
var localPrice = () => ({
  inputPer1k: LOCAL_MODEL_COST,
  outputPer1k: LOCAL_MODEL_COST,
  currency: "USD"
});
var PRICING = {
  // Frontier reference prices (USD per 1k tokens).
  "claude-opus-4": { inputPer1k: 0.015, outputPer1k: 0.075, currency: "USD" },
  "claude-sonnet-4": { inputPer1k: 3e-3, outputPer1k: 0.015, currency: "USD" },
  "claude-haiku-4": { inputPer1k: 8e-4, outputPer1k: 4e-3, currency: "USD" },
  "gpt-4o": { inputPer1k: 5e-3, outputPer1k: 0.015, currency: "USD" },
  "gpt-4o-mini": { inputPer1k: 15e-5, outputPer1k: 6e-4, currency: "USD" },
  // Local / self-hosted models — estimated cost.
  gemma: localPrice(),
  qwen: localPrice(),
  qwythos: localPrice(),
  coder: localPrice()
};
var LOCAL_SUBSTRINGS = ["gemma", "qwen", "qwythos", "coder"];
function priceFor(model, pricing = PRICING) {
  if (pricing[model]) return pricing[model];
  const key = model.toLowerCase();
  for (const [id, price] of Object.entries(pricing)) {
    const idl = id.toLowerCase();
    if (key.includes(idl) || idl.includes(key)) return price;
  }
  for (const sub of LOCAL_SUBSTRINGS) {
    if (key.includes(sub)) return localPrice();
  }
  return localPrice();
}
function costOf(record, pricing = PRICING) {
  const price = priceFor(record.modelServed ?? record.model, pricing);
  let promptTokens = record.promptTokens;
  let completionTokens = record.completionTokens;
  if (promptTokens === void 0 || completionTokens === void 0) {
    const half = record.tokens / 2;
    promptTokens = promptTokens ?? half;
    completionTokens = completionTokens ?? half;
  }
  const inputCost = promptTokens / 1e3 * price.inputPer1k;
  const outputCost = completionTokens / 1e3 * price.outputPer1k;
  return {
    inputCost,
    outputCost,
    total: inputCost + outputCost,
    currency: price.currency
  };
}

// src/store.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
var FinopsStore = class {
  entries = [];
  pricing;
  constructor(pricing = PRICING) {
    this.pricing = pricing;
  }
  ingest(e) {
    const cost = costOf(e, this.pricing);
    this.entries.push({
      ts: e.ts,
      model: e.modelServed ?? e.model,
      caller: e.caller ?? "unknown",
      gateway: e.gateway,
      usd: cost.total,
      tokens: e.tokens
    });
  }
  groupBy(key) {
    const out = {};
    for (const e of this.entries) out[key(e)] = (out[key(e)] ?? 0) + e.usd;
    return out;
  }
  spendByModel() {
    return this.groupBy((e) => e.model);
  }
  spendByCaller() {
    return this.groupBy((e) => e.caller);
  }
  spendByGateway() {
    return this.groupBy((e) => e.gateway);
  }
  /** Spend for the trailing `days` (default 30), one bucket per UTC day. */
  dailySpend(days = 30) {
    const now = Date.now();
    const cutoff = now - days * DAY_MS;
    const buckets = /* @__PURE__ */ new Map();
    for (const e of this.entries) {
      if (e.ts < cutoff) continue;
      const day = new Date(e.ts).toISOString().slice(0, 10);
      let b = buckets.get(day);
      if (!b) {
        b = { day, usd: 0, tokens: 0, requests: 0 };
        buckets.set(day, b);
      }
      b.usd += e.usd;
      b.tokens += e.tokens;
      b.requests += 1;
    }
    return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
  }
  /** Extrapolate a 30-day spend from the trailing `windowDays` (default 7). */
  projectedMonthlyUsd(windowDays = 7) {
    const now = Date.now();
    const cutoff = now - windowDays * DAY_MS;
    let usd = 0;
    for (const e of this.entries) if (e.ts >= cutoff) usd += e.usd;
    if (usd === 0) return 0;
    return usd / windowDays * 30;
  }
  /** Accumulated spend for a single caller (all time). */
  spendForCaller(caller) {
    let usd = 0;
    for (const e of this.entries) if (e.caller === caller) usd += e.usd;
    return usd;
  }
  totals() {
    let totalUsd = 0;
    let totalTokens = 0;
    for (const e of this.entries) {
      totalUsd += e.usd;
      totalTokens += e.tokens;
    }
    return { totalUsd, totalTokens, requests: this.entries.length };
  }
};
function finopsSink(store) {
  return { name: "finops", record: (e) => store.ingest(e) };
}

// src/policy.ts
function budgetPolicy(opts) {
  const per = opts.per ?? "org";
  return {
    name: "finops-budget",
    pre(ctx) {
      const spend = per === "caller" ? opts.store.spendForCaller(ctx.caller) : opts.store.projectedMonthlyUsd();
      if (spend >= opts.monthlyUsd) {
        ctx.deny = {
          status: 402,
          message: "monthly budget exceeded",
          policy: "finops-budget"
        };
      }
    }
  };
}

// src/report.ts
function toFinopsReport(store) {
  return {
    byModel: store.spendByModel(),
    byCaller: store.spendByCaller(),
    byGateway: store.spendByGateway(),
    daily: store.dailySpend(),
    projectedMonthly: store.projectedMonthlyUsd(),
    totals: store.totals(),
    generatedAt: Date.now(),
    currency: "USD"
  };
}
var FINOPS_INTEGRATIONS = [
  { id: "builtin", name: "Built-in cost tracker", category: "finops" },
  { id: "console-finops", name: "Off Grid Console FinOps plane", category: "finops" },
  { id: "csv-export", name: "CSV export", category: "finops" },
  { id: "cloudability", name: "Apptio Cloudability", category: "finops" },
  { id: "opencost", name: "OpenCost", category: "finops" }
];
export {
  FINOPS_INTEGRATIONS,
  FinopsStore,
  LOCAL_MODEL_COST,
  PRICING,
  budgetPolicy,
  costOf,
  finopsSink,
  priceFor,
  toFinopsReport
};
