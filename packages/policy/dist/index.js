// src/messages.ts
function getMessages(body) {
  const m = body.messages;
  return Array.isArray(m) ? m : [];
}
function lastUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}
function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part && typeof part === "object") {
        const p = part;
        if (p.type === "text" && typeof p.text === "string") return p.text;
      }
      return "";
    }).join("");
  }
  return "";
}
function readLastUserText(body) {
  const messages = getMessages(body);
  const i = lastUserIndex(messages);
  if (i < 0) return "";
  return contentText(messages[i]?.content);
}
function rewriteLastUserText(body, next) {
  const messages = getMessages(body);
  const i = lastUserIndex(messages);
  if (i < 0) return false;
  const msg = messages[i];
  const content = msg.content;
  if (typeof content === "string") {
    msg.content = next;
    return true;
  }
  if (Array.isArray(content)) {
    const parts = content;
    const ti = parts.findIndex((p) => p && p.type === "text");
    if (ti >= 0) parts[ti].text = next;
    else parts.unshift({ type: "text", text: next });
    return true;
  }
  msg.content = next;
  return true;
}

// src/hash.ts
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// src/guardrails.ts
function toRegExp(p) {
  if (p instanceof RegExp) return p;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
}
async function presidioRedact(text, presidioUrl) {
  const base = presidioUrl.replace(/\/+$/, "");
  try {
    const analyzeRes = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, language: "en" })
    });
    if (!analyzeRes.ok) return text;
    const analyzerResults = await analyzeRes.json();
    if (!Array.isArray(analyzerResults) || analyzerResults.length === 0) return text;
    const anonRes = await fetch(`${base}/anonymize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, analyzer_results: analyzerResults })
    });
    if (!anonRes.ok) return text;
    const anon = await anonRes.json();
    return typeof anon.text === "string" ? anon.text : text;
  } catch {
    return text;
  }
}
function guardrails(opts = {}) {
  const patterns = (opts.denyPatterns ?? []).map(toRegExp);
  const blocked = new Set(opts.blockedModels ?? []);
  return {
    name: "guardrails",
    async pre(ctx) {
      if (blocked.has(ctx.model)) {
        ctx.deny = {
          status: 403,
          message: `model '${ctx.model}' is blocked by policy`,
          policy: "guardrails"
        };
        return;
      }
      const text = readLastUserText(ctx.body);
      for (const re of patterns) {
        if (re.test(text)) {
          ctx.deny = {
            status: 400,
            message: "request blocked by content guardrail",
            policy: "guardrails"
          };
          return;
        }
      }
      if (typeof opts.maxInputChars === "number" && text.length > opts.maxInputChars) {
        ctx.deny = {
          status: 400,
          message: `input exceeds ${opts.maxInputChars} characters`,
          policy: "guardrails"
        };
        return;
      }
      if (opts.piiRedact && opts.presidioUrl && text) {
        const redacted = await presidioRedact(text, opts.presidioUrl);
        if (redacted !== text) {
          rewriteLastUserText(ctx.body, redacted);
          ctx.meta.piiRedacted = true;
        }
      }
    }
  };
}

// src/rate-limit.ts
function rateLimit(opts) {
  const per = opts.per ?? "caller";
  const capacity = Math.max(1, opts.rpm);
  const refillPerMs = capacity / 6e4;
  const buckets = /* @__PURE__ */ new Map();
  const keyOf = (ctx) => per === "model" ? ctx.model : ctx.caller;
  return {
    name: "rate-limit",
    pre(ctx) {
      const key = keyOf(ctx);
      const now = Date.now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: capacity, last: now };
        buckets.set(key, b);
      }
      const elapsed = now - b.last;
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
      b.last = now;
      if (b.tokens < 1) {
        ctx.deny = { status: 429, message: "rate limit exceeded", policy: "rate-limit" };
        return;
      }
      b.tokens -= 1;
    }
  };
}

// src/budget.ts
function budget(opts) {
  const per = opts.per ?? "caller";
  const windowMs = opts.windowMs ?? 6e4;
  const ledgers = /* @__PURE__ */ new Map();
  const keyOf = (ctx) => per === "model" ? ctx.model : ctx.caller;
  const prune = (key, now) => {
    const cutoff = now - windowMs;
    const kept = (ledgers.get(key) ?? []).filter((e) => e.ts >= cutoff);
    ledgers.set(key, kept);
    let total = 0;
    for (const e of kept) total += e.tokens;
    return { entries: kept, total };
  };
  return {
    name: "budget",
    pre(ctx) {
      const now = Date.now();
      const { total } = prune(keyOf(ctx), now);
      if (total >= opts.maxTokens) {
        ctx.deny = { status: 429, message: "token budget exceeded", policy: "budget" };
      }
    },
    post(ctx, o) {
      const spent = (o.promptTokens || 0) + (o.completionTokens || 0);
      if (spent <= 0) return;
      const key = keyOf(ctx);
      const entries = ledgers.get(key) ?? [];
      entries.push({ ts: Date.now(), tokens: spent });
      ledgers.set(key, entries);
    }
  };
}

// src/cache.ts
function isStreaming(body) {
  return body.stream === true;
}
function cacheKey(body) {
  const model = String(body.model ?? "");
  const messages = JSON.stringify(body.messages ?? null);
  const temperature = String(body.temperature ?? "");
  const maxTokens = String(body.max_tokens ?? body.maxTokens ?? "");
  return fnv1a(`${model}\0${messages}\0${temperature}\0${maxTokens}`);
}
function cache(opts = {}) {
  const ttlMs = opts.ttlMs ?? 3e5;
  const maxEntries = opts.maxEntries ?? 500;
  const store = /* @__PURE__ */ new Map();
  return {
    name: "cache",
    pre(ctx) {
      if (isStreaming(ctx.body)) return;
      const key = cacheKey(ctx.body);
      const hit = store.get(key);
      if (!hit) return;
      if (hit.expires <= Date.now()) {
        store.delete(key);
        return;
      }
      ctx.meta.cacheKey = key;
      ctx.shortCircuit = { status: 200, json: hit.value, from: "cache" };
    },
    post(ctx, o) {
      if (o.streamed || o.status !== 200 || o.raw === void 0) return;
      if (ctx.shortCircuit?.from === "cache") return;
      const key = cacheKey(ctx.body);
      store.set(key, { value: o.raw, expires: Date.now() + ttlMs });
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === void 0) break;
        store.delete(oldest);
      }
    }
  };
}

// src/from-env.ts
function policiesFromEnv(env = readProcessEnv()) {
  const policies = [];
  const deny = splitList(env.OFFGRID_GUARDRAIL_DENY);
  const blockedModels = splitList(env.OFFGRID_BLOCKED_MODELS);
  const maxInputChars = num(env.OFFGRID_MAX_INPUT_CHARS);
  const presidioUrl = env.OFFGRID_PRESIDIO_URL?.trim() || void 0;
  if (deny.length || blockedModels.length || maxInputChars || presidioUrl) {
    policies.push(
      guardrails({
        denyPatterns: deny.length ? deny : void 0,
        blockedModels: blockedModels.length ? blockedModels : void 0,
        maxInputChars,
        piiRedact: Boolean(presidioUrl),
        presidioUrl
      })
    );
  }
  const rpm = num(env.OFFGRID_RATELIMIT_RPM);
  if (rpm && rpm > 0) policies.push(rateLimit({ rpm }));
  const maxTokens = num(env.OFFGRID_BUDGET_TOKENS);
  if (maxTokens && maxTokens > 0) {
    policies.push(budget({ maxTokens, windowMs: num(env.OFFGRID_BUDGET_WINDOW_MS) }));
  }
  const ttlMs = num(env.OFFGRID_CACHE_TTL_MS);
  if (ttlMs && ttlMs > 0) policies.push(cache({ ttlMs }));
  return policies;
}
function readProcessEnv() {
  const g = globalThis;
  return g.process?.env ?? {};
}
function splitList(v) {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
function num(v) {
  if (v === void 0 || v.trim() === "") return void 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : void 0;
}

// src/catalog.ts
var GUARDRAIL_INTEGRATIONS = [
  {
    id: "presidio",
    name: "Microsoft Presidio (PII)",
    category: "guardrail",
    configFields: ["url"],
    description: "Detect and redact PII via a local Presidio analyzer/anonymizer."
  },
  {
    id: "regex",
    name: "Regex/Keyword deny",
    category: "guardrail",
    configFields: ["patterns"],
    description: "Block requests whose text matches keyword substrings or regexes."
  },
  {
    id: "llm-judge",
    name: "LLM judge",
    category: "guardrail",
    configFields: ["model", "rubric"],
    description: "Route input through a local model that judges against a rubric."
  },
  {
    id: "json-schema",
    name: "JSON schema validate",
    category: "guardrail",
    configFields: ["schema"],
    description: "Validate structured output against a JSON schema."
  },
  {
    id: "max-input",
    name: "Max input size",
    category: "guardrail",
    configFields: ["maxInputChars"],
    description: "Reject prompts larger than a character cap."
  },
  {
    id: "blocked-models",
    name: "Model allow/deny list",
    category: "guardrail",
    configFields: ["blockedModels"],
    description: "Refuse requests targeting disallowed models."
  },
  {
    id: "secrets-scan",
    name: "Secret/credential scan",
    category: "guardrail",
    configFields: [],
    description: "Detect leaked API keys, tokens, and private keys in prompts."
  }
];
var RATE_LIMIT_INTEGRATIONS = [
  {
    id: "token-bucket",
    name: "Token-bucket RPM",
    category: "rate-limit",
    configFields: ["rpm", "per"],
    description: "In-process requests-per-minute limiter keyed by caller or model."
  }
];
var BUDGET_INTEGRATIONS = [
  {
    id: "rolling-tokens",
    name: "Rolling token budget",
    category: "budget",
    configFields: ["maxTokens", "windowMs", "per"],
    description: "Sliding-window token spend cap per caller or model."
  }
];
var CACHE_INTEGRATIONS = [
  {
    id: "exact-memory",
    name: "Exact-match memory cache",
    category: "cache",
    configFields: ["ttlMs", "maxEntries"],
    description: "In-process cache of non-streaming responses keyed by request hash."
  }
];
var POLICY_INTEGRATIONS = [
  ...GUARDRAIL_INTEGRATIONS,
  ...RATE_LIMIT_INTEGRATIONS,
  ...BUDGET_INTEGRATIONS,
  ...CACHE_INTEGRATIONS
];
export {
  BUDGET_INTEGRATIONS,
  CACHE_INTEGRATIONS,
  GUARDRAIL_INTEGRATIONS,
  POLICY_INTEGRATIONS,
  RATE_LIMIT_INTEGRATIONS,
  budget,
  cache,
  contentText,
  fnv1a,
  getMessages,
  guardrails,
  lastUserIndex,
  policiesFromEnv,
  rateLimit,
  readLastUserText,
  rewriteLastUserText
};
