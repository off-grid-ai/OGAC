#!/usr/bin/env node

// src/cluster/server.ts
import http from "http";

// src/cluster/capture.ts
var LOG_MAX = 2e3;
var TrafficStore = class {
  constructor(sinks = []) {
    this.sinks = sinks;
  }
  sinks;
  startedAt = Date.now();
  log = [];
  stats = {};
  record(e) {
    this.log.push(e);
    if (this.log.length > LOG_MAX) this.log.shift();
    const s = this.stats[e.gateway] ||= { requests: 0, errors: 0, totalMs: 0, tokens: 0 };
    s.requests += 1;
    if (!e.status || e.status >= 400) s.errors += 1;
    s.totalMs += e.ms;
    if (e.tokens) s.tokens += e.tokens;
    for (const sink of this.sinks) {
      try {
        sink.record(e);
      } catch {
      }
    }
  }
  /** Records within the recency window for a node (health derivation reads this). */
  recentFor(name, windowMs, now = Date.now()) {
    return this.log.filter((e) => e.gateway === name && now - e.ts <= windowMs);
  }
  counters(name) {
    return this.stats[name] || { requests: 0, errors: 0, totalMs: 0, tokens: 0 };
  }
  statsFor(name, model, health, gauges = { inflight: 0, queued: 0, peakInflight: 0 }) {
    const s = this.counters(name);
    return {
      gateway: name,
      model,
      requests: s.requests,
      errors: s.errors,
      totalMs: s.totalMs,
      tokens: s.tokens,
      avgMs: s.requests ? Math.round(s.totalMs / s.requests) : 0,
      health,
      inflight: gauges.inflight,
      queued: gauges.queued,
      peakInflight: gauges.peakInflight
    };
  }
  /** Newest-first copy of the rolling log. */
  recent() {
    return this.log.slice().reverse();
  }
};

// src/cluster/health.ts
function healthConfig(o = {}) {
  const n = (v, d) => v == null ? d : Number(v);
  return {
    windowMs: o.windowMs ?? n(process.env.OFFGRID_HEALTH_WINDOW_MS, 12e4),
    slowMs: o.slowMs ?? n(process.env.OFFGRID_HEALTH_SLOW_MS, 3e4),
    jamMs: o.jamMs ?? n(process.env.OFFGRID_HEALTH_JAM_MS, 9e4),
    degradedErrRate: o.degradedErrRate ?? n(process.env.OFFGRID_HEALTH_ERR_RATE, 0.25),
    downErrRate: o.downErrRate ?? n(process.env.OFFGRID_HEALTH_DOWN_ERR_RATE, 0.6),
    probeEnabled: o.probeEnabled ?? process.env.OFFGRID_HEALTH_PROBE !== "0",
    probeEveryMs: o.probeEveryMs ?? n(process.env.OFFGRID_HEALTH_PROBE_MS, 6e4),
    probeTimeoutMs: o.probeTimeoutMs ?? n(process.env.OFFGRID_HEALTH_PROBE_TIMEOUT_MS, 8e3)
  };
}
var HealthMonitor = class {
  constructor(traffic, cfg) {
    this.traffic = traffic;
    this.cfg = cfg;
  }
  traffic;
  cfg;
  probe = {};
  timer = null;
  /** Seed reachability from a cheap liveness check so health isn't 'unknown' on cold start. */
  seed(name, reachable) {
    if (!this.probe[name]) this.probe[name] = { reachable, genOk: null, genMs: null, ts: Date.now() };
  }
  // eslint-disable-next-line complexity
  healthFor(name) {
    const now = Date.now();
    const recent = this.traffic.recentFor(name, this.cfg.windowMs, now);
    const p = this.probe[name];
    const probeFresh = p && now - p.ts <= this.cfg.windowMs;
    if (probeFresh && !p.reachable && !recent.some((e) => e.status && e.status < 400)) return "down";
    const errs = recent.filter((e) => !e.status || e.status >= 400).length;
    const errRate = recent.length ? errs / recent.length : 0;
    const avgMs = recent.length ? recent.reduce((a, e) => a + (e.ms || 0), 0) / recent.length : 0;
    if (probeFresh && p.reachable && p.genOk === false) return "down";
    if (probeFresh && p.reachable && p.genMs != null && p.genMs >= this.cfg.slowMs) return "degraded";
    if (recent.length >= 2) {
      if (errRate >= this.cfg.downErrRate || avgMs >= this.cfg.jamMs) return "down";
      if (errRate >= this.cfg.degradedErrRate || avgMs >= this.cfg.slowMs) return "degraded";
    }
    if (probeFresh && p.reachable) return "up";
    if (recent.some((e) => e.status && e.status < 400)) return "up";
    return probeFresh ? "up" : "unknown";
  }
  async probeOne(g) {
    const started = Date.now();
    try {
      const h = await fetch(`http://${g.host}:${g.port}/health`, { signal: AbortSignal.timeout(2e3) }).catch(
        () => null
      );
      const reachable = !!(h && h.ok);
      if (!reachable) {
        this.probe[g.name] = { reachable: false, genOk: null, genMs: null, ts: Date.now() };
        return;
      }
      const genStart = Date.now();
      const r = await fetch(`http://${g.host}:${g.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: g.model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
        signal: AbortSignal.timeout(this.cfg.probeTimeoutMs)
      }).catch(() => null);
      this.probe[g.name] = { reachable: true, genOk: !!(r && r.ok), genMs: Date.now() - genStart, ts: Date.now() };
    } catch {
      this.probe[g.name] = { reachable: false, genOk: false, genMs: Date.now() - started, ts: Date.now() };
    }
  }
  /** Start staggered background probing across the live nodes (one per tick). */
  start(live) {
    if (!this.cfg.probeEnabled || this.timer) return;
    let i = 0;
    const stagger = Math.max(500, Math.floor(this.cfg.probeEveryMs / Math.max(1, live.length)));
    this.timer = setInterval(() => {
      const g = live[i++ % live.length];
      if (g) void this.probeOne(g);
    }, stagger);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
};

// src/cluster/router.ts
var Router = class {
  constructor(live) {
    this.live = live;
  }
  live;
  rr = {};
  rrPick(nodes) {
    if (!nodes.length) return void 0;
    const k = nodes.map((g) => g.name).join(",");
    this.rr[k] = ((this.rr[k] || 0) + 1) % nodes.length;
    return nodes[this.rr[k]];
  }
  /** The eligible nodes for a request (the family that can serve it). */
  candidates(model, image) {
    const m = (model || "").toLowerCase();
    const byModel = (tag) => this.live.filter((g) => g.model.includes(tag));
    if (image) {
      if (m.includes("gemma")) return this.live.filter((g) => g.model.includes("gemma") && g.vision);
      if (m.includes("qwen")) return this.live.filter((g) => g.model.includes("qwen") && g.vision);
      return this.live.filter((g) => g.vision);
    }
    if (m.includes("gemma")) return byModel("gemma");
    if (m.includes("coder")) return byModel("qwen3-coder");
    if (m.includes("qwen")) return byModel("qwen3.5");
    if (m.includes("qwythos")) return byModel("qwythos");
    return this.live;
  }
  pick(model, image) {
    return this.rrPick(this.candidates(model, image));
  }
  /** Load-aware pick: the least-loaded node in the family (round-robin breaks ties).
   *  This spreads pressure off a saturating node before it jams. */
  pickLeastLoaded(model, image, load) {
    const c = this.candidates(model, image);
    if (c.length <= 1) return c[0] ?? this.rrPick(this.live);
    let min = Infinity;
    for (const g of c) min = Math.min(min, load(g.name));
    const leastLoaded = c.filter((g) => load(g.name) === min);
    return this.rrPick(leastLoaded);
  }
};
function hasImage(body) {
  try {
    return /"type"\s*:\s*"(image_url|input_image|image)"/.test(JSON.stringify(body.messages || []));
  } catch {
    return false;
  }
}

// src/cluster/limiter.ts
function limiterConfig(o = {}) {
  const n = (v, d) => v == null ? d : Number(v);
  return {
    maxConcurrentPerNode: o.maxConcurrentPerNode ?? n(process.env.OFFGRID_MAX_CONCURRENT_PER_NODE, 2),
    maxQueuePerNode: o.maxQueuePerNode ?? n(process.env.OFFGRID_MAX_QUEUE_PER_NODE, 24),
    acquireTimeoutMs: o.acquireTimeoutMs ?? n(process.env.OFFGRID_QUEUE_TIMEOUT_MS, 3e4)
  };
}
var Saturated = class extends Error {
  constructor(node) {
    super(`node ${node} saturated`);
    this.node = node;
    this.name = "Saturated";
  }
  node;
};
var AdmissionLimiter = class {
  constructor(cfg) {
    this.cfg = cfg;
  }
  cfg;
  state = {};
  nodeState(name) {
    return this.state[name] ||= { active: 0, peak: 0, waiters: [] };
  }
  /** Acquire a slot for a node. Resolves when a slot is free; rejects Saturated
   *  if the wait-queue is full or the wait times out. */
  acquire(name) {
    const s = this.nodeState(name);
    if (s.active < this.cfg.maxConcurrentPerNode) {
      s.active += 1;
      if (s.active > s.peak) s.peak = s.active;
      return Promise.resolve();
    }
    if (s.waiters.length >= this.cfg.maxQueuePerNode) return Promise.reject(new Saturated(name));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = s.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) s.waiters.splice(i, 1);
        reject(new Saturated(name));
      }, this.cfg.acquireTimeoutMs);
      timer.unref?.();
      s.waiters.push({ resolve, reject, timer });
    });
  }
  /** Release a slot; hands it to the next waiter if any. */
  release(name) {
    const s = this.nodeState(name);
    const next = s.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      if (s.active > s.peak) s.peak = s.active;
      next.resolve();
    } else {
      s.active = Math.max(0, s.active - 1);
    }
  }
  inflight(name) {
    return this.state[name]?.active ?? 0;
  }
  queued(name) {
    return this.state[name]?.waiters.length ?? 0;
  }
  peak(name) {
    return this.state[name]?.peak ?? 0;
  }
  /** Total load signal for a node (in-flight + queued) — used for load-aware routing. */
  load(name) {
    const s = this.state[name];
    return s ? s.active + s.waiters.length : 0;
  }
};

// src/cluster/observability.ts
function openSearchSink(url, index = "offgrid-gateway") {
  return {
    name: `opensearch(${index})`,
    record(e) {
      try {
        void fetch(`${url}/${index}/_doc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ "@timestamp": new Date(e.ts).toISOString(), source: "offgrid-gateway-cluster", ...e })
        }).catch(() => {
        });
      } catch {
      }
    }
  };
}
function langfuseSink(baseUrl, publicKey, secretKey) {
  const auth = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  return {
    name: "langfuse",
    record(e) {
      try {
        const iso = new Date(e.ts).toISOString();
        const id = `${e.gateway}-${e.ts}`;
        void fetch(`${baseUrl}/api/public/ingestion`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: auth },
          body: JSON.stringify({
            batch: [
              { id: `t-${id}`, type: "trace-create", timestamp: iso, body: { id: `trace-${id}`, name: `gateway:${e.kind}`, metadata: { gateway: e.gateway, corrId: e.corrId } } },
              {
                id: `g-${id}`,
                type: "generation-create",
                timestamp: iso,
                body: {
                  traceId: `trace-${id}`,
                  name: e.model,
                  model: e.modelServed ?? e.model,
                  input: e.input,
                  output: e.output,
                  usage: { input: e.promptTokens, output: e.completionTokens, total: e.tokens },
                  metadata: { gateway: e.gateway, tps: e.tps, finish: e.finish, ms: e.ms }
                }
              }
            ]
          })
        }).catch(() => {
        });
      } catch {
      }
    }
  };
}
function stdoutSink() {
  return {
    name: "stdout",
    record(e) {
      console.log(
        `[req] ${new Date(e.ts).toISOString()} ${e.gateway} ${e.model} ${e.kind} ${e.status} ${e.ms}ms ${e.bytes}b${e.tokens ? ` tok=${e.tokens}` : ""}`
      );
    }
  };
}
function sinksFromEnv() {
  const sinks = [stdoutSink()];
  const os = process.env.OFFGRID_OPENSEARCH_URL;
  if (os) sinks.push(openSearchSink(os, process.env.OFFGRID_GATEWAY_INDEX || "offgrid-gateway"));
  const lf = process.env.OFFGRID_LANGFUSE_URL;
  const pk = process.env.OFFGRID_LANGFUSE_PUBLIC_KEY;
  const sk = process.env.OFFGRID_LANGFUSE_SECRET_KEY;
  if (lf && pk && sk) sinks.push(langfuseSink(lf, pk, sk));
  return sinks;
}

// src/cluster/dashboard.ts
var DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Off Grid \xB7 Gateway</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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" />
<style>
  :root { --ground:#0a0a0a; --panel:#111; --line:#262626; --text:#e5e5e5; --dim:#8a8a8a; --up:#34d399; --warn:#f59e0b; --down:#ef4444; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--text); font:13px/1.5 Menlo,ui-monospace,SFMono-Regular,monospace; }
  header { display:flex; align-items:baseline; gap:14px; padding:18px 22px; border-bottom:1px solid var(--line); }
  header h1 { margin:0; font-size:15px; letter-spacing:.02em; }
  header h1 b { color:var(--up); }
  header .sub { color:var(--dim); font-size:11px; }
  header .live { margin-left:auto; color:var(--up); font-size:11px; display:flex; align-items:center; gap:6px; }
  header .live .pulse { width:7px; height:7px; border-radius:50%; background:var(--up); animation:p 1.6s infinite; }
  @keyframes p { 0%,100%{opacity:1} 50%{opacity:.3} }
  main { padding:22px; max-width:1200px; }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:26px 0 12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
  .node { border:1px solid var(--line); border-radius:8px; padding:13px 15px; background:var(--panel); }
  .node .top { display:flex; align-items:center; justify-content:space-between; }
  .node .name { display:flex; align-items:center; gap:7px; font-weight:600; }
  .dot { width:8px; height:8px; border-radius:50%; }
  .up .dot{background:var(--up)} .degraded .dot{background:var(--warn)} .down .dot{background:var(--down)} .unknown .dot{background:var(--dim)}
  .up .st{color:var(--up)} .degraded .st{color:var(--warn)} .down .st{color:var(--down)} .unknown .st{color:var(--dim)}
  .st { font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
  .node .model { color:var(--dim); font-size:11px; margin:3px 0 10px; }
  .row { display:flex; justify-content:space-between; padding:1px 0; color:var(--dim); }
  .row b { color:var(--text); font-weight:500; }
  .row.bp { border-top:1px dashed var(--line); margin-top:6px; padding-top:6px; }
  .row.bp .q { color:var(--warn); }
  .row.bp .f { color:var(--up); }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; color:var(--dim); font-weight:500; font-size:10px; text-transform:uppercase; letter-spacing:.06em; padding:7px 10px; border-bottom:1px solid var(--line); }
  td { padding:7px 10px; border-bottom:1px solid #191919; }
  td.tag { color:var(--up); }
  td.err { color:var(--down); }
  .empty { color:var(--dim); padding:26px; text-align:center; }
  .scroll { overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
</style>
</head>
<body>
  <header>
    <h1>OFF&nbsp;GRID <b>/</b> gateway</h1>
    <span class="sub" id="sub">connecting\u2026</span>
    <span class="live"><span class="pulse"></span> live</span>
  </header>
  <main>
    <h2>Nodes &amp; backpressure</h2>
    <div class="grid" id="nodes"></div>
    <h2>Recent calls</h2>
    <div class="scroll"><table>
      <thead><tr><th>time</th><th>node</th><th>model</th><th>status</th><th>ttfb</th><th>latency</th><th>tok/s</th><th>tokens</th></tr></thead>
      <tbody id="recent"></tbody>
    </table></div>
  </main>
<script>
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); };
  function nodeCard(s){
    var h = s.health || 'unknown';
    return '<div class="node '+h+'">'
      + '<div class="top"><span class="name"><span class="dot"></span>'+esc(s.gateway)+'</span><span class="st">'+h+'</span></div>'
      + '<div class="model">'+esc(s.model)+'</div>'
      + '<div class="row">requests <b>'+s.requests+'</b></div>'
      + '<div class="row">errors <b>'+s.errors+'</b></div>'
      + '<div class="row">avg latency <b>'+s.avgMs+' ms</b></div>'
      + '<div class="row">tokens <b>'+s.tokens+'</b></div>'
      + (s.inflight!==undefined ? '<div class="row bp">in-flight <b class="f">'+s.inflight+'</b></div>'
          + '<div class="row bp" style="border:0;margin:0;padding:1px 0">queued <b class="q">'+(s.queued||0)+'</b></div>'
          + '<div class="row" >peak <b>'+(s.peakInflight||0)+'</b></div>' : '')
      + '</div>';
  }
  function row(c){
    var t = new Date(c.ts).toLocaleTimeString();
    var bad = !c.status || c.status>=400;
    return '<tr><td>'+t+'</td><td class="tag">'+esc(c.gateway)+'</td><td>'+esc(c.model)+'</td>'
      + '<td class="'+(bad?'err':'')+'">'+c.status+'</td>'
      + '<td>'+(c.ttfb!=null?c.ttfb+' ms':'\u2014')+'</td>'
      + '<td>'+c.ms+' ms</td><td>'+(c.tps||'\u2014')+'</td><td>'+(c.tokens||'\u2014')+'</td></tr>';
  }
  function tick(){
    fetch('/traffic',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
      var up = (d.stats||[]).filter(function(s){return s.health==='up';}).length;
      document.getElementById('sub').textContent = (d.stats||[]).length+' nodes \xB7 '+up+' up \xB7 since '+ (d.since? new Date(d.since).toLocaleTimeString():'\u2014');
      document.getElementById('nodes').innerHTML = (d.stats||[]).map(nodeCard).join('');
      var r = (d.recent||[]).slice(0,40);
      document.getElementById('recent').innerHTML = r.length ? r.map(row).join('') : '<tr><td colspan="8" class="empty">no traffic yet \u2014 calls through the gateway appear here</td></tr>';
    }).catch(function(){ document.getElementById('sub').textContent='gateway unreachable'; });
  }
  tick(); setInterval(tick, 2000);
</script>
</body>
</html>`;

// src/cluster/models.ts
var base = (g) => `http://${g.host}:${g.port}`;
async function getJson(url, timeoutMs = 5e3) {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
async function send(url, method, body, timeoutMs = 1e4) {
  try {
    const r = await fetch(url, {
      method,
      cache: "no-store",
      headers: body ? { "content-type": "application/json" } : void 0,
      body: body ? JSON.stringify(body) : void 0,
      signal: AbortSignal.timeout(timeoutMs)
    });
    let data = null;
    try {
      data = await r.json();
    } catch {
    }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
async function nodeModels(g) {
  const [catalog, installed, active] = await Promise.all([
    getJson(`${base(g)}/v1/models/catalog`),
    getJson(`${base(g)}/v1/models/installed`),
    getJson(`${base(g)}/v1/models/active`)
  ]);
  return {
    node: g.name,
    catalog: catalog?.models ?? [],
    installed: installed?.installed ?? [],
    active: active ?? null,
    reachable: catalog != null || installed != null || active != null
  };
}
function activateModel(g, id, kind) {
  return send(`${base(g)}/v1/models/activate`, "POST", kind ? { id, kind } : { id });
}
async function unloadModel(g, kind = "text") {
  const r = await send(`${base(g)}/v1/models/unload`, "POST", { kind });
  if (r.status !== 404) return r;
  return send(`${base(g)}/v1/models/activate`, "POST", { id: "", kind });
}
function pullModel(g, id) {
  return send(`${base(g)}/v1/models/pull`, "POST", { id });
}
function deleteModel(g, id) {
  return send(`${base(g)}/v1/models/${encodeURIComponent(id)}`, "DELETE");
}
async function getSettings(g) {
  const s = await getJson(`${base(g)}/v1/settings`);
  return { supported: s != null, settings: s };
}
async function setSettings(g, settings) {
  const r = await send(`${base(g)}/v1/settings`, "POST", settings);
  return { supported: r.status !== 404, ok: r.ok, status: r.status, data: r.data };
}

// src/policy/types.ts
async function runPre(policies, ctx) {
  for (const p of policies) {
    if (ctx.deny || ctx.shortCircuit) return;
    if (p.pre) {
      try {
        await p.pre(ctx);
      } catch {
      }
    }
  }
}
async function runPost(policies, ctx, outcome) {
  for (const p of policies) {
    if (p.post) {
      try {
        await p.post(ctx, outcome);
      } catch {
      }
    }
  }
}

// src/cluster/keycloak.ts
import crypto from "crypto";
var CACHE_TTL_MS = 10 * 60 * 1e3;
function b64url(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function jwkToPublicKey(jwk) {
  if (jwk.kty === "RSA" && jwk.n && jwk.e) {
    return crypto.createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  }
  if (jwk.kty === "EC" && jwk.x && jwk.y && jwk.crv) {
    return crypto.createPublicKey({ key: { kty: "EC", x: jwk.x, y: jwk.y, crv: jwk.crv }, format: "jwk" });
  }
  throw new Error(`Unsupported JWK type: ${jwk.kty}`);
}
var KeycloakValidator = class {
  constructor(config) {
    this.config = config;
    this.issuer = `${config.url}/realms/${config.realm}`;
  }
  config;
  cache = null;
  fetching = null;
  issuer;
  jwksUrl() {
    return `${this.issuer}/protocol/openid-connect/certs`;
  }
  async fetchKeys() {
    const r = await fetch(this.jwksUrl(), { signal: AbortSignal.timeout(5e3) });
    if (!r.ok) throw new Error(`JWKS fetch failed: ${r.status}`);
    const { keys } = await r.json();
    const map = /* @__PURE__ */ new Map();
    for (const jwk of keys) {
      if (jwk.use === "sig" || !jwk.use) {
        try {
          map.set(jwk.kid, jwkToPublicKey(jwk));
        } catch {
        }
      }
    }
    return { keys: map, fetchedAt: Date.now() };
  }
  async getKeys(kid) {
    const stale = !this.cache || Date.now() - this.cache.fetchedAt > CACHE_TTL_MS;
    const unknownKid = kid && this.cache && !this.cache.keys.has(kid);
    if (stale || unknownKid) {
      if (!this.fetching) this.fetching = this.fetchKeys().finally(() => {
        this.fetching = null;
      });
      this.cache = await this.fetching;
    }
    return this.cache;
  }
  /** Verify a raw JWT string. Returns decoded claims or throws on failure. */
  async verify(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed JWT");
    const headerRaw = JSON.parse(b64url(parts[0]).toString());
    const payload = JSON.parse(b64url(parts[1]).toString());
    const now = Math.floor(Date.now() / 1e3);
    if (payload.exp && payload.exp < now) throw new Error("JWT expired");
    if (payload.iss !== this.issuer) throw new Error(`JWT issuer mismatch: ${payload.iss}`);
    if (this.config.clientId) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud ?? ""];
      if (!aud.includes(this.config.clientId) && payload.azp !== this.config.clientId) {
        throw new Error("JWT audience mismatch");
      }
    }
    const cache = await this.getKeys(headerRaw.kid);
    const key = headerRaw.kid ? cache.keys.get(headerRaw.kid) : [...cache.keys.values()][0];
    if (!key) throw new Error(`No key for kid=${headerRaw.kid ?? "unknown"}`);
    const alg = headerRaw.alg ?? "RS256";
    const nodeAlg = alg.startsWith("ES") ? alg.replace("ES", "SHA") : alg.replace("RS", "SHA").replace("PS", "SHA");
    const sigInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sig = b64url(parts[2]);
    const ok = alg.startsWith("PS") ? crypto.verify(nodeAlg, sigInput, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }, sig) : crypto.verify(nodeAlg, sigInput, key, sig);
    if (!ok) throw new Error("JWT signature invalid");
    return payload;
  }
};
var instances = /* @__PURE__ */ new Map();
function getValidator(cfg) {
  const k = `${cfg.url}|${cfg.realm}|${cfg.clientId ?? ""}`;
  if (!instances.has(k)) instances.set(k, new KeycloakValidator(cfg));
  return instances.get(k);
}
function keycloakConfigFromEnv() {
  const url = process.env.OFFGRID_KEYCLOAK_URL;
  const realm = process.env.OFFGRID_KEYCLOAK_REALM;
  if (!url || !realm) return null;
  return { url, realm, clientId: process.env.OFFGRID_KEYCLOAK_CLIENT_ID };
}

// src/cluster/server.ts
var DEFAULT_POOL = [
  { name: "g1", host: "127.0.0.1", port: 7878, vision: true, model: "default" }
];
function resolvePool(pool) {
  if (pool?.length) return pool;
  if (process.env.OFFGRID_POOL) {
    try {
      return JSON.parse(process.env.OFFGRID_POOL);
    } catch {
    }
  }
  return DEFAULT_POOL;
}
var json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
};
function promptText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m && m.role === "user");
  const c = lastUser?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p && p.type === "text" && p.text).map((p) => p.text).join("\n") : "";
  return text.slice(0, 2e3);
}
function normalizeMessages(raw, body) {
  if (!Array.isArray(body.messages)) return raw;
  const sysTexts = [];
  const rest = [];
  let needsFix = false;
  let seenNonSystem = false;
  for (const m of body.messages) {
    if (m.role === "system") {
      if (seenNonSystem) needsFix = true;
      let text = "";
      if (typeof m.content === "string") text = m.content;
      else if (Array.isArray(m.content))
        text = m.content.filter((p) => p && p.type === "text" && p.text).map((p) => p.text).join("\n");
      if (text.trim()) sysTexts.push(text.trim());
    } else {
      seenNonSystem = true;
      rest.push(m);
    }
  }
  if (!needsFix) return raw;
  body.messages = sysTexts.length ? [{ role: "system", content: sysTexts.join("\n\n") }, ...rest] : rest;
  return Buffer.from(JSON.stringify(body));
}
var GATEWAY_CONFIG_SCHEMA = [
  // ── Networking ──────────────────────────────────────────────────────────────
  { key: "OFFGRID_CLUSTER_PORT", group: "Networking", label: "Listen port", type: "number", liveReload: false, secret: false, description: "Port the cluster gateway listens on. Requires restart." },
  { key: "OFFGRID_CLUSTER_HOST", group: "Networking", label: "Listen host", type: "string", liveReload: false, secret: false, description: "Bind address (0.0.0.0 = all interfaces). Requires restart." },
  { key: "HOST_HINT", group: "Networking", label: "Host hint", type: "string", liveReload: false, secret: false, description: "IP shown in info URLs (display only)." },
  // ── Auth ────────────────────────────────────────────────────────────────────
  { key: "OFFGRID_GATEWAY_API_KEY", group: "Auth", label: "Gateway API key", type: "string", liveReload: false, secret: true, description: "Static Bearer/x-api-key accepted on all non-healthz routes (console + automation). Unset = open (LAN only)." },
  { key: "OFFGRID_KEYCLOAK_URL", group: "Auth", label: "Keycloak URL", type: "string", liveReload: false, secret: false, description: "Keycloak base URL, e.g. https://sso.example.com. Enables JWT validation for human + machine clients." },
  { key: "OFFGRID_KEYCLOAK_REALM", group: "Auth", label: "Keycloak realm", type: "string", liveReload: false, secret: false, description: "Keycloak realm name, e.g. offgrid." },
  { key: "OFFGRID_KEYCLOAK_CLIENT_ID", group: "Auth", label: "Keycloak client ID", type: "string", liveReload: false, secret: false, description: "Expected audience (aud/azp) in gateway-bound JWTs. Leave blank to skip audience check." },
  // ── Observability ───────────────────────────────────────────────────────────
  { key: "OFFGRID_RAW_HEADERS", group: "Observability", label: "Raw header logging", type: "boolean", liveReload: true, secret: false, description: "Log all inbound request + upstream response headers on every call. Toggle without restart." },
  { key: "OFFGRID_OPENSEARCH_URL", group: "Observability", label: "OpenSearch URL", type: "string", liveReload: false, secret: false, description: "Base URL of the OpenSearch instance for durable call logging." },
  { key: "OFFGRID_GATEWAY_INDEX", group: "Observability", label: "OpenSearch index", type: "string", liveReload: false, secret: false, description: "Index name for gateway call documents. Default: offgrid-gateway." },
  { key: "OFFGRID_LANGFUSE_URL", group: "Observability", label: "Langfuse URL", type: "string", liveReload: false, secret: false, description: "Langfuse ingestion endpoint for LLM-native tracing." },
  { key: "OFFGRID_LANGFUSE_PUBLIC_KEY", group: "Observability", label: "Langfuse public key", type: "string", liveReload: false, secret: false, description: "Langfuse project public key." },
  { key: "OFFGRID_LANGFUSE_SECRET_KEY", group: "Observability", label: "Langfuse secret key", type: "string", liveReload: false, secret: true, description: "Langfuse project secret key." },
  // ── Admission control ───────────────────────────────────────────────────────
  { key: "OFFGRID_MAX_CONCURRENT_PER_NODE", group: "Admission control", label: "Max concurrent per node", type: "number", liveReload: true, secret: false, description: "Max in-flight requests per node before queuing begins." },
  { key: "OFFGRID_MAX_QUEUE_PER_NODE", group: "Admission control", label: "Max queue per node", type: "number", liveReload: true, secret: false, description: "Max requests waiting per node; beyond this the gateway 503s." },
  { key: "OFFGRID_QUEUE_TIMEOUT_MS", group: "Admission control", label: "Queue timeout (ms)", type: "number", liveReload: true, secret: false, description: "How long a queued request waits before being rejected." },
  // ── Health ──────────────────────────────────────────────────────────────────
  { key: "OFFGRID_HEALTH_WINDOW_MS", group: "Health", label: "Health window (ms)", type: "number", liveReload: false, secret: false, description: "Rolling window over which error rate + latency are computed." },
  { key: "OFFGRID_HEALTH_SLOW_MS", group: "Health", label: "Slow threshold (ms)", type: "number", liveReload: false, secret: false, description: "P50 latency above this \u2192 degraded." },
  { key: "OFFGRID_HEALTH_JAM_MS", group: "Health", label: "Jam threshold (ms)", type: "number", liveReload: false, secret: false, description: "P50 latency above this \u2192 down (KV-cache jam)." },
  { key: "OFFGRID_HEALTH_ERR_RATE", group: "Health", label: "Degraded error rate", type: "number", liveReload: false, secret: false, description: "Error rate (0\u20131) above which a node is degraded." },
  { key: "OFFGRID_HEALTH_DOWN_ERR_RATE", group: "Health", label: "Down error rate", type: "number", liveReload: false, secret: false, description: "Error rate (0\u20131) above which a node is marked down." },
  { key: "OFFGRID_HEALTH_PROBE", group: "Health", label: "Probe enabled", type: "boolean", liveReload: false, secret: false, description: "Run a 1-token probe on idle nodes to catch jams without live traffic." },
  { key: "OFFGRID_HEALTH_PROBE_MS", group: "Health", label: "Probe interval (ms)", type: "number", liveReload: false, secret: false, description: "How often to probe idle nodes." },
  { key: "OFFGRID_HEALTH_PROBE_TIMEOUT_MS", group: "Health", label: "Probe timeout (ms)", type: "number", liveReload: false, secret: false, description: "Max wait for a probe response before marking the node down." }
];
function createClusterGateway(opts = {}) {
  const pool = resolvePool(opts.pool);
  const live = pool.filter((g) => g.enabled !== false);
  const port = opts.port ?? Number(process.env.OFFGRID_CLUSTER_PORT || process.env.PORT || 8800);
  const host = opts.host ?? process.env.OFFGRID_CLUSTER_HOST ?? "0.0.0.0";
  const hostHint = opts.hostHint ?? process.env.HOST_HINT ?? "127.0.0.1";
  const sinks = [...sinksFromEnv(), ...opts.sinks ?? []];
  const policies = opts.policies ?? [];
  let rawHeaders = opts.rawHeaders ?? process.env.OFFGRID_RAW_HEADERS === "true";
  const kcCfg = keycloakConfigFromEnv();
  const tokenStore = policies.find((p) => p.name === "client-auth")?.tokens;
  const apiKey = process.env.OFFGRID_GATEWAY_API_KEY;
  const cfg = healthConfig(opts.health);
  const traffic = new TrafficStore(sinks);
  const health = new HealthMonitor(traffic, cfg);
  const router = new Router(live);
  const limiter = new AdmissionLimiter(limiterConfig());
  const trafficJSON = () => ({
    since: new Date(traffic.startedAt).toISOString(),
    pool: pool.map((g) => ({ name: g.name, model: g.model, vision: g.vision })),
    stats: pool.map(
      (g) => traffic.statsFor(g.name, g.model, health.healthFor(g.name), {
        inflight: limiter.inflight(g.name),
        queued: limiter.queued(g.name),
        peakInflight: limiter.peak(g.name)
      })
    ),
    recent: traffic.recent()
  });
  const poolInfo = async () => {
    const infos = await Promise.all(
      pool.map(async (g) => {
        try {
          const r = await fetch(`http://${g.host}:${g.port}/`, { signal: AbortSignal.timeout(1500) });
          health.seed(g.name, r.ok);
          return { g, info: r.ok ? await r.json() : null };
        } catch {
          health.seed(g.name, false);
          return { g, info: null };
        }
      })
    );
    const modalities = {};
    for (const { info } of infos)
      for (const [k, v] of Object.entries(info?.modalities || {}))
        if (v === "ready" || !modalities[k]) modalities[k] = v;
    return {
      name: "Off Grid AI \u2014 gateway cluster",
      openai_compatible: true,
      base_url: `http://${hostHint}:${port}/v1`,
      modalities: Object.keys(modalities).length ? modalities : { text: "ready", vision_understanding: "ready" },
      gateways: infos.map(({ g, info }) => ({ name: g.name, host: g.host, model: g.model, vision: g.vision, up: !!info, health: health.healthFor(g.name) }))
    };
  };
  const checkAuth = async (req) => {
    if (!apiKey && !kcCfg) return true;
    const auth = String(req.headers["authorization"] || "");
    const xApiKey = String(req.headers["x-api-key"] || "");
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (apiKey && (xApiKey === apiKey || bearerToken === apiKey)) return true;
    if (kcCfg && bearerToken) {
      try {
        await getValidator(kcCfg).verify(bearerToken);
        return true;
      } catch {
      }
    }
    return false;
  };
  const handleRequest = (req, res, url, wantsHtml) => {
    if (url === "/" && wantsHtml || url === "/dashboard") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(DASHBOARD_HTML);
    }
    if (url === "/" || url === "/health")
      return void poolInfo().then((i) => json(res, 200, i)).catch(() => json(res, 200, { name: "Off Grid AI \u2014 gateway cluster", pool }));
    if (url === "/traffic" || url === "/traffic.json") return void json(res, 200, trafficJSON());
    if (url === "/tokens") {
      if (!tokenStore) return void json(res, 200, []);
      return void json(res, 200, tokenStore.list());
    }
    if (url === "/config" && req.method === "GET") {
      const entries = GATEWAY_CONFIG_SCHEMA.map((s) => ({
        ...s,
        value: s.secret ? process.env[s.key] ? "***" : "" : process.env[s.key] ?? "",
        current: s.key === "OFFGRID_RAW_HEADERS" ? String(rawHeaders) : process.env[s.key] ?? ""
      }));
      return void json(res, 200, { entries });
    }
    if (url === "/config" && req.method === "POST") {
      const cs = [];
      req.on("data", (c) => cs.push(c));
      req.on("end", () => {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(cs).toString() || "{}");
        } catch {
        }
        const applied = [];
        const restartRequired = [];
        for (const [k, v] of Object.entries(body.settings ?? {})) {
          const schema = GATEWAY_CONFIG_SCHEMA.find((s) => s.key === k);
          if (!schema) continue;
          process.env[k] = String(v);
          if (schema.liveReload) {
            if (k === "OFFGRID_RAW_HEADERS") rawHeaders = v === "true" || v === "1";
            applied.push(k);
          } else {
            restartRequired.push(k);
          }
        }
        return void json(res, 200, { ok: true, applied, restartRequired });
      });
      return;
    }
    if (url === "/v1/models") {
      const models = [...new Set(pool.map((g) => g.model))].map((id) => {
        const nodes = pool.filter((g) => g.model === id);
        return { id, object: "model", owned_by: "offgrid", capabilities: nodes.some((g) => g.vision) ? ["text", "vision"] : ["text"], gateways: nodes.map((g) => g.name) };
      });
      return void json(res, 200, { object: "list", data: models });
    }
    if (url === "/nodes" && req.method === "GET") {
      return void Promise.all(
        pool.map(async (g) => {
          const v = await nodeModels(g);
          return { name: g.name, host: g.host, model: g.model, vision: !!g.vision, health: health.healthFor(g.name), reachable: v.reachable, active: v.active, installed: v.installed, catalogCount: Array.isArray(v.catalog) ? v.catalog.length : 0 };
        })
      ).then((nodes) => json(res, 200, { available: true, nodes })).catch(() => json(res, 200, { available: false, nodes: [] }));
    }
    if (url.startsWith("/nodes/") && req.method === "POST") {
      const name = decodeURIComponent(url.slice("/nodes/".length));
      const g = pool.find((p) => p.name === name);
      if (!g) return void json(res, 404, { error: `unknown node ${name}` });
      const cs = [];
      req.on("data", (c) => cs.push(c));
      req.on("end", () => {
        let b = {};
        try {
          b = JSON.parse(Buffer.concat(cs).toString() || "{}");
        } catch {
        }
        const done = (p) => void p.then((r) => json(res, 200, r)).catch((e) => json(res, 502, { error: e.message }));
        switch (b.action) {
          case "activate":
            return b.id ? done(activateModel(g, b.id, b.kind)) : void json(res, 400, { error: "id required" });
          case "unload":
            return done(unloadModel(g, b.kind ?? "text"));
          case "pull":
            return b.id ? done(pullModel(g, b.id)) : void json(res, 400, { error: "id required" });
          case "delete":
            return b.id ? done(deleteModel(g, b.id)) : void json(res, 400, { error: "id required" });
          case "settings":
            return done(b.settings ? setSettings(g, b.settings) : getSettings(g));
          default:
            return void json(res, 400, { error: `unknown action ${b.action}` });
        }
      });
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks);
      let body = {};
      try {
        body = JSON.parse(raw.toString() || "{}");
      } catch {
      }
      const image = hasImage(body);
      const target = router.pickLeastLoaded(body.model, image, (n) => limiter.load(n)) || live[0];
      if (!target) return void json(res, 503, { error: { message: "no live gateway in pool", type: "no_upstream" } });
      const kind = image ? "image" : "text";
      const started = Date.now();
      const streaming = body.stream === true;
      const caller = String(req.headers["user-agent"] || "").slice(0, 80);
      const corrId = String(req.headers["x-offgrid-run"] || req.headers["x-request-id"] || "");
      const xForwardedFor = String(req.headers["x-forwarded-for"] || "");
      const clientIp = (xForwardedFor ? xForwardedFor.split(",")[0] : req.socket.remoteAddress || "").trim();
      const params = {
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        topP: body.top_p,
        thinking: body?.chat_template_kwargs?.enable_thinking !== false,
        toolsOffered: Array.isArray(body.tools) ? body.tools.length : 0
      };
      const msgs = Array.isArray(body.messages) ? body.messages.map((m) => ({
        role: m.role,
        text: (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((p) => p && p.type === "text" && p.text).map((p) => p.text).join("\n") : "").slice(0, 600)
      })) : [];
      const ctx = {
        caller,
        corrId,
        model: body.model || target.model,
        image,
        body,
        target,
        candidates: live,
        clientIp,
        // Stash raw inbound headers for policies (e.g. client-auth) that need them.
        meta: { _inboundHeaders: req.headers }
      };
      if (policies.length) {
        await runPre(policies, ctx);
        if (ctx.deny) {
          traffic.record({ ts: Date.now(), gateway: target.name, model: ctx.model, modelServed: target.model, kind, status: ctx.deny.status, ms: Date.now() - started, bytes: 0, tokens: 0, caller, corrId, params, msgs, input: promptText(body), output: `(denied by policy ${ctx.deny.policy}: ${ctx.deny.message})` });
          return void json(res, ctx.deny.status, { error: { message: ctx.deny.message, type: "policy_denied", policy: ctx.deny.policy } });
        }
        if (ctx.shortCircuit) {
          const sc = ctx.shortCircuit;
          json(res, sc.status, sc.json);
          const out = JSON.stringify(sc.json).slice(0, 2e3);
          traffic.record({ ts: Date.now(), gateway: target.name, model: ctx.model, modelServed: sc.from, kind, status: sc.status, ms: Date.now() - started, bytes: out.length, tokens: 0, caller, corrId, params, msgs, input: promptText(body), output: out });
          void runPost(policies, ctx, { status: sc.status, output: out, promptTokens: 0, completionTokens: 0, streamed: false, raw: sc.json });
          return;
        }
      }
      try {
        await limiter.acquire(target.name);
      } catch (e) {
        if (e instanceof Saturated) {
          traffic.record({ ts: Date.now(), gateway: target.name, model: body.model || target.model, modelServed: target.model, kind, status: 503, ms: Date.now() - started, bytes: 0, tokens: 0, caller, corrId, params, msgs, input: promptText(body), output: "(shed: node saturated)" });
          res.writeHead(503, { "content-type": "application/json", "retry-after": "2" });
          return void res.end(JSON.stringify({ error: { message: `gateway ${target.name} saturated \u2014 retry shortly`, type: "backpressure" } }));
        }
        throw e;
      }
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          limiter.release(target.name);
        }
      };
      res.on("close", release);
      const forwarded = normalizeMessages(raw, ctx.body);
      const up = http.request(
        {
          host: target.host,
          port: target.port,
          method: req.method,
          path: req.url,
          headers: {
            ...req.headers,
            host: `${target.host}:${target.port}`,
            "content-length": forwarded.length
          }
        },
        (ur) => {
          res.writeHead(ur.statusCode || 502, { ...ur.headers, "x-offgrid-gateway": target.name, "x-offgrid-model": target.model });
          let bytes = 0;
          let firstByteAt = 0;
          let writeBlocked = 0;
          const buf = [];
          ur.on("data", (c) => {
            if (!firstByteAt) firstByteAt = Date.now();
            bytes += c.length;
            if (!res.write(c)) writeBlocked += 1;
            if (buf.length < 500) buf.push(c);
          });
          ur.on("end", () => {
            res.end();
            release();
            let tokens = 0;
            let promptTokens = 0;
            let completionTokens = 0;
            let output = "";
            let reasoning = "";
            let finish = "";
            let tps = 0;
            let toolCalls = [];
            const rawResp = Buffer.concat(buf).toString();
            try {
              if (streaming) {
                for (const line of rawResp.split("\n")) {
                  const t = line.trim();
                  if (!t.startsWith("data:")) continue;
                  const d = t.slice(5).trim();
                  if (d === "[DONE]") continue;
                  const ch = JSON.parse(d)?.choices?.[0];
                  output += ch?.delta?.content || "";
                  reasoning += ch?.delta?.reasoning_content || "";
                  if (ch?.finish_reason) finish = ch.finish_reason;
                  const tc = ch?.delta?.tool_calls;
                  if (Array.isArray(tc)) {
                    for (const c of tc) if (c?.function?.name) toolCalls.push({ name: c.function.name, args: (c.function.arguments || "").slice(0, 400) });
                  }
                }
              } else {
                const j = JSON.parse(rawResp);
                const ch = j?.choices?.[0];
                tokens = j?.usage?.total_tokens || 0;
                promptTokens = j?.usage?.prompt_tokens || 0;
                completionTokens = j?.usage?.completion_tokens || 0;
                finish = ch?.message?.finish_reason || ch?.finish_reason || "";
                tps = j?.timings?.predicted_per_second ? Math.round(j.timings.predicted_per_second) : 0;
                output = ch?.message?.content || "";
                reasoning = ch?.message?.reasoning_content || "";
                const tc = ch?.message?.tool_calls;
                if (Array.isArray(tc)) toolCalls = tc.map((c) => ({ name: c?.function?.name || "", args: (c?.function?.arguments || "").slice(0, 400) }));
              }
            } catch {
            }
            const elapsed = Date.now() - started;
            if (!tps && completionTokens && elapsed > 0) tps = Math.round(completionTokens / elapsed * 1e3);
            traffic.record({
              ts: Date.now(),
              gateway: target.name,
              model: body.model || target.model,
              modelServed: target.model,
              kind,
              status: ur.statusCode || 0,
              ms: elapsed,
              bytes,
              tokens,
              promptTokens,
              completionTokens,
              tps,
              ttfb: firstByteAt ? firstByteAt - started : void 0,
              writeBlocked,
              finish,
              toolCalls,
              reasoning: reasoning.slice(0, 2e3),
              caller,
              corrId,
              params,
              msgs,
              input: promptText(body),
              output: output.slice(0, 2e3),
              ...rawHeaders && {
                requestHeaders: Object.fromEntries(
                  Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v ?? ""])
                ),
                responseHeaders: Object.fromEntries(
                  Object.entries(ur.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v ?? ""])
                )
              }
            });
            if (policies.length)
              void runPost(policies, ctx, { status: ur.statusCode || 0, output, promptTokens, completionTokens, streamed: streaming });
          });
        }
      );
      up.on("error", (e) => {
        release();
        traffic.record({
          ts: Date.now(),
          gateway: target.name,
          model: body.model || target.model,
          modelServed: target.model,
          kind,
          status: 502,
          ms: Date.now() - started,
          bytes: 0,
          tokens: 0,
          caller,
          corrId,
          params,
          msgs,
          input: promptText(body),
          output: `(error: ${e.message})`
        });
        json(res, 502, { error: { message: `gateway ${target.name} (${target.host}) error: ${e.message}`, type: "upstream_error" } });
      });
      up.setTimeout(12e4, () => up.destroy(new Error("upstream timeout")));
      up.end(forwarded);
    });
  };
  const server = http.createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    const wantsHtml = String(req.headers.accept || "").includes("text/html");
    if (url === "/healthz") return void json(res, 200, { ok: true });
    void (async () => {
      if ((apiKey || kcCfg) && !await checkAuth(req)) {
        return void json(res, 401, { error: { message: "invalid or missing credentials", type: "unauthorized" } });
      }
      handleRequest(req, res, url, wantsHtml);
    })();
  });
  const api = {
    server,
    pool,
    live,
    traffic,
    health,
    trafficJSON,
    poolInfo,
    listen() {
      server.listen(port, host, () => {
        console.log(`[cluster] routing on ${host}:${port} across`, pool.map((g) => `${g.name}:${g.model}${g.vision ? "+vision" : ""}${g.enabled === false ? " (off)" : ""}`).join(", "));
        console.log(`[cluster] observability sinks:`, sinks.map((s) => s.name).join(", "));
      });
      health.start(live);
      return this;
    },
    close() {
      health.stop();
      server.close();
    }
  };
  return api;
}

// src/cluster-cli.ts
createClusterGateway().listen();
