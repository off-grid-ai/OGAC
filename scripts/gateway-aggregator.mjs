// Off Grid gateway aggregator — one OpenAI-compatible endpoint that routes across the
// gateway pool by model + modality. Dependency-free (Node http). Runs on S1 as a service.
//
//   text request            -> round-robin the text gateways (g1 Gemma 12B, g2 Qwen 9B)
//   request with an image    -> a vision gateway (g2 Qwen, or g3 Gemma E4B if named)
//   model names "gemma…" text -> g1 (Gemma 12B)  |  "qwen…" -> g2  |  image+gemma -> g3
//
// Adds `x-offgrid-gateway` to responses so you can see where each call went.
//
// Auth (safe to expose via the tunnel): every route except /healthz requires either
// the static key (OFFGRID_GATEWAY_API_KEY, as Bearer or x-api-key) OR a valid Keycloak
// JWT (OFFGRID_KEYCLOAK_URL + _REALM). Keys are ISSUED by Keycloak (a service-account
// client → client_credentials → JWT) — we don't run our own key store. If neither is
// configured the endpoint is open (LAN-only dev default).
import http from 'node:http';
import crypto from 'node:crypto';
import { verifierFromEnv } from './lib/keycloak-verify.mjs';

const API_KEY = process.env.OFFGRID_GATEWAY_API_KEY || '';

// ── Client-token store (Mode B: bring-your-own provider key + forward-proxy) ────
// Records the (client IP, provider token, inferred meta) triple for every request
// that carries a client's OWN provider credential — NOT our gateway API key. The
// console polls /tokens and persists this into Postgres (gateway_client_tokens).
const TOKENS = new Map(); // fingerprint -> { fingerprint, preview, kind, inferred, ips, uses, firstSeen, lastSeen }
const TOKENS_CAP = 500;

function inferProvider(token) {
  if (token.startsWith('sk-ant-')) return { provider: 'anthropic', tokenType: 'api-key' };
  if (token.startsWith('sk-proj-')) return { provider: 'openai', tokenType: 'project-key' };
  if (token.startsWith('sk-')) return { provider: 'openai', tokenType: 'api-key' };
  if (token.startsWith('AIza')) return { provider: 'google', tokenType: 'api-key' };
  if (token.startsWith('gsk_')) return { provider: 'groq', tokenType: 'api-key' };
  if (token.startsWith('xai-')) return { provider: 'xai', tokenType: 'api-key' };
  if (token.startsWith('r8_')) return { provider: 'replicate', tokenType: 'api-key' };
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
      return { provider: 'jwt', tokenType: 'jwt', jwt: { header: {}, payload } };
    } catch { /* not a JWT */ }
  }
  return { tokenType: 'opaque' };
}

function clientIp(req) {
  return String(
    req.headers['cf-connecting-ip'] ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown',
  ).replace(/^::ffff:/, '');
}

// Pull the client's OWN provider token (never our gateway key) from the request.
function extractClientToken(req) {
  const provKey = req.headers['x-provider-key'];
  if (provKey) return { token: String(provKey), kind: 'x-api-key' };
  const auth = String(req.headers['authorization'] || '');
  if (auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t && t !== API_KEY) return { token: t, kind: 'bearer' };
  }
  const xk = String(req.headers['x-api-key'] || '');
  if (xk && xk !== API_KEY) return { token: xk, kind: 'x-api-key' };
  return null;
}

function captureToken(req) {
  const found = extractClientToken(req);
  if (!found) return;
  const { token, kind } = found;
  const fingerprint = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  const ip = clientIp(req);
  const now = Date.now();
  let e = TOKENS.get(fingerprint);
  if (!e) {
    e = {
      fingerprint,
      preview: `${token.slice(0, 6)}…${token.slice(-4)}`,
      kind,
      inferred: inferProvider(token),
      ips: {},
      uses: 0,
      firstSeen: now,
      lastSeen: now,
    };
    TOKENS.set(fingerprint, e);
    if (TOKENS.size > TOKENS_CAP) {
      const oldest = [...TOKENS.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) TOKENS.delete(oldest[0]);
    }
  }
  e.uses++;
  e.lastSeen = now;
  e.ips[ip] = (e.ips[ip] || 0) + 1;
}
const kc = verifierFromEnv();
const AUTH_ON = Boolean(API_KEY || kc);

// Returns true if the request may proceed. /healthz is always open (liveness probe).
async function authOK(req, url) {
  if (url === '/healthz') return true;
  if (!AUTH_ON) return true; // no gate configured → open (LAN)
  const hdr = String(req.headers['authorization'] || '');
  const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  const xKey = String(req.headers['x-api-key'] || '');
  if (API_KEY && (xKey === API_KEY || bearer === API_KEY)) return true;
  if (kc && bearer) { try { await kc.verify(bearer); return true; } catch { /* fall through */ } }
  return false;
}

const PORT = Number(process.env.PORT || 8800);
const HOST_HINT = process.env.HOST_HINT || '127.0.0.1'; // for display in info URLs only
// role map — one model per gateway (edit IPs via OFFGRID_POOL JSON if they change)
const POOL = JSON.parse(process.env.OFFGRID_POOL || JSON.stringify([
  { name: 'g1',  host: '192.168.1.57', port: 7878, vision: true,  model: 'qwythos-9b' },
  { name: 'g2',  host: '192.168.1.58', port: 7878, vision: true,  model: 'qwen3.5-9b' },
  { name: 'g3',  host: '192.168.1.32', port: 7878, vision: true,  model: 'qwythos-9b' },
  { name: 'g4',  host: '192.168.1.63', port: 7878, vision: true,  model: 'qwythos-9b' },
  { name: 'g5',  host: '192.168.1.65', port: 7878, vision: true,  model: 'qwen3.5-9b' },
  { name: 'g6',  host: '192.168.1.66', port: 7878, vision: true,  model: 'qwen3.5-9b' },
  { name: 'g7',  host: '192.168.1.62', port: 7878, vision: true,  model: 'qwythos-9b' },
  { name: 'g8',  host: '192.168.1.64', port: 7878, vision: true,  model: 'qwythos-9b' },
]));
const LIVE = POOL.filter((g) => g.enabled !== false); // only route to enabled gateways

// per-model round-robin counters
const rr = {};
function rrPick(nodes) {
  const k = nodes.map((g) => g.name).join(',');
  rr[k] = ((rr[k] || 0) + 1) % nodes.length;
  return nodes[rr[k]];
}

// --- traffic monitoring: rolling log of recent calls + per-gateway counters ---
const LOG = [];        // last N proxied requests (newest last)
const LOG_MAX = 300;
const STATS = {};      // per-gateway { requests, errors, totalMs, tokens }
const startedAt = Date.now();
const OS_URL = process.env.OFFGRID_OPENSEARCH_URL || 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX || 'offgrid-gateway';
// Durable, SIEM-searchable gateway log: fire-and-forget index each call into OpenSearch.
function shipToOpenSearch(e) {
  try {
    fetch(`${OS_URL}/${OS_INDEX}/_doc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ '@timestamp': new Date(e.ts).toISOString(), source: 'gateway-aggregator', ...e }),
    }).catch(() => {});
  } catch { /* never block a request on logging */ }
}
function record(e) {
  e.ts = Date.now();
  LOG.push(e);
  if (LOG.length > LOG_MAX) LOG.shift();
  const s = (STATS[e.gateway] ||= { requests: 0, errors: 0, totalMs: 0, tokens: 0 });
  s.requests += 1;
  if (!e.status || e.status >= 400) s.errors += 1;
  s.totalMs += e.ms;
  if (e.tokens) s.tokens += e.tokens;
  console.log(`[req] ${new Date(e.ts).toISOString()} ${e.gateway} ${e.model} ${e.kind} ${e.status} ${e.ms}ms ${e.bytes}b${e.tokens ? ` tok=${e.tokens}` : ''}`);
  shipToOpenSearch(e);
}
// --- TRUE inference health (not just "process answers /health") ---
// A gateway is only 'up' if it is reachable AND its recent inference behaviour looks healthy.
// A jammed gateway (KV-cache exhausted) still answers /health but times out or errors on
// generation, so process-reachability alone lies. We fold three cheap signals together:
//   1. reachability of the HTTP process (from the last probe / recent traffic),
//   2. recent error rate over the rolling LOG,
//   3. recent average latency (jams show up as very slow or timing-out generations),
// plus an optional bounded 1-token probe that catches jams even with zero live traffic.
const HEALTH_WINDOW_MS = Number(process.env.OFFGRID_HEALTH_WINDOW_MS || 120000); // recent = last 2 min
const SLOW_MS = Number(process.env.OFFGRID_HEALTH_SLOW_MS || 30000);             // avg > 30s ⇒ degraded
const JAM_MS = Number(process.env.OFFGRID_HEALTH_JAM_MS || 90000);              // avg > 90s ⇒ jammed/down
const DEGRADED_ERR_RATE = Number(process.env.OFFGRID_HEALTH_ERR_RATE || 0.25);   // ≥25% recent errors ⇒ degraded
const DOWN_ERR_RATE = Number(process.env.OFFGRID_HEALTH_DOWN_ERR_RATE || 0.6);   // ≥60% recent errors ⇒ down

// Latest probe result per gateway: { reachable, genOk, genMs, ts }.
const PROBE = {};

// eslint-disable-next-line complexity
function healthFor(name) {
  const now = Date.now();
  const recent = LOG.filter((e) => e.gateway === name && now - e.ts <= HEALTH_WINDOW_MS);
  const p = PROBE[name];
  const probeFresh = p && now - p.ts <= HEALTH_WINDOW_MS;

  // Process unreachable (probe says so, and no successful recent traffic contradicts it) ⇒ down.
  if (probeFresh && !p.reachable && !recent.some((e) => e.status && e.status < 400)) return 'down';

  const errs = recent.filter((e) => !e.status || e.status >= 400).length;
  const errRate = recent.length ? errs / recent.length : 0;
  const avgMs = recent.length ? recent.reduce((a, e) => a + (e.ms || 0), 0) / recent.length : 0;

  // Probe reached the process but a bounded 1-token generation failed or crawled ⇒ jammed.
  if (probeFresh && p.reachable && p.genOk === false) return 'down';
  if (probeFresh && p.reachable && p.genMs != null && p.genMs >= SLOW_MS) return 'degraded';

  // Live-traffic signals (only meaningful with samples in the window).
  if (recent.length >= 2) {
    if (errRate >= DOWN_ERR_RATE || avgMs >= JAM_MS) return 'down';
    if (errRate >= DEGRADED_ERR_RATE || avgMs >= SLOW_MS) return 'degraded';
  }
  if (probeFresh && p.reachable) return 'up';
  if (recent.some((e) => e.status && e.status < 400)) return 'up';
  return probeFresh ? 'up' : 'unknown'; // no probe yet + no traffic ⇒ genuinely unknown
}

// Cheap periodic probe: 1-token generation per LIVE gateway, bounded to PROBE_TIMEOUT.
// Fire-and-forget, staggered, never on the request path — so it catches jams with no traffic.
const PROBE_TIMEOUT = Number(process.env.OFFGRID_HEALTH_PROBE_TIMEOUT_MS || 45000);
const PROBE_EVERY = Number(process.env.OFFGRID_HEALTH_PROBE_MS || 60000);
const PROBE_ENABLED = process.env.OFFGRID_HEALTH_PROBE !== '0';
async function probeGateway(g) {
  const started = Date.now();
  try {
    // Reachability first (mirrors the old process check).
    const h = await fetch(`http://${g.host}:${g.port}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
    const reachable = !!(h && h.ok);
    if (!reachable) { PROBE[g.name] = { reachable: false, genOk: null, genMs: null, ts: Date.now() }; return; }
    // Bounded 1-token generation — this is what a jammed KV-cache fails/stalls on.
    const genStart = Date.now();
    const r = await fetch(`http://${g.host}:${g.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: g.model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    }).catch(() => null);
    const genMs = Date.now() - genStart;
    PROBE[g.name] = { reachable: true, genOk: !!(r && r.ok), genMs, ts: Date.now() };
  } catch {
    PROBE[g.name] = { reachable: false, genOk: false, genMs: Date.now() - started, ts: Date.now() };
  }
}
function startProbing() {
  if (!PROBE_ENABLED) return;
  let i = 0;
  const stagger = Math.max(500, Math.floor(PROBE_EVERY / Math.max(1, LIVE.length)));
  // One gateway per stagger tick, cycling — spreads load, keeps each cheap and non-blocking.
  setInterval(() => { const g = LIVE[i++ % LIVE.length]; if (g) probeGateway(g); }, stagger).unref();
}

function trafficJSON() {
  return {
    since: new Date(startedAt).toISOString(),
    pool: POOL.map((g) => ({ name: g.name, model: g.model, vision: g.vision })),
    stats: POOL.map((g) => {
      const s = STATS[g.name] || { requests: 0, errors: 0, totalMs: 0, tokens: 0 };
      return { gateway: g.name, model: g.model, ...s, avgMs: s.requests ? Math.round(s.totalMs / s.requests) : 0, health: healthFor(g.name) };
    }),
    recent: LOG.slice().reverse(),
  };
}

const hasImage = (b) => {
  try { return /"type"\s*:\s*"(image_url|input_image|image)"/.test(JSON.stringify(b.messages || [])); }
  catch { return false; }
};
function pick(model, image) {
  const m = (model || '').toLowerCase();
  const byModel = (tag) => LIVE.filter((g) => g.model.includes(tag));
  if (image) {
    if (m.includes('gemma')) return rrPick(LIVE.filter((g) => g.model.includes('gemma') && g.vision));
    if (m.includes('qwen'))  return rrPick(LIVE.filter((g) => g.model.includes('qwen')  && g.vision));
    return rrPick(LIVE.filter((g) => g.vision)); // any vision node
  }
  if (m.includes('gemma'))   return rrPick(byModel('gemma'));
if (m.includes('qwen'))    return rrPick(byModel('qwen3.5'));
  if (m.includes('qwythos')) return rrPick(byModel('qwythos'));
  return rrPick(LIVE); // unspecified: round-robin everything
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

// The prompt text (last user turn) for the traffic log — so you can see what went in.
function promptText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
  const c = lastUser?.content;
  const text = typeof c === 'string' ? c
    : Array.isArray(c) ? c.filter((p) => p && p.type === 'text' && p.text).map((p) => p.text).join('\n') : '';
  return text.slice(0, 2000);
}

// Fetch each gateway's own info JSON (modalities) and merge — so the console Gateway
// page renders the full modality grid even though it's talking to the aggregator.
async function poolInfo() {
  const infos = await Promise.all(POOL.map(async (g) => {
    try {
      const r = await fetch(`http://${g.host}:${g.port}/`, { signal: AbortSignal.timeout(1500) });
      // Seed reachability if we've never probed this gateway, so health isn't 'unknown' on cold start.
      if (!PROBE[g.name]) PROBE[g.name] = { reachable: r.ok, genOk: null, genMs: null, ts: Date.now() };
      return { g, info: r.ok ? await r.json() : null };
    } catch { if (!PROBE[g.name]) PROBE[g.name] = { reachable: false, genOk: null, genMs: null, ts: Date.now() }; return { g, info: null }; }
  }));
  const modalities = {};
  for (const { info } of infos) for (const [k, v] of Object.entries(info?.modalities || {}))
    if (v === 'ready' || !modalities[k]) modalities[k] = v;
  return {
    name: 'Off Grid AI — gateway aggregator',
    openai_compatible: true,
    base_url: `http://${HOST_HINT}:${PORT}/v1`,
    docs: `http://${HOST_HINT}:${PORT}/v1`,
    mcp: `http://${HOST_HINT}:${PORT}/mcp`,
    modalities: Object.keys(modalities).length ? modalities : { text: 'ready', vision_understanding: 'ready' },
    image_models: [],
    gateways: infos.map(({ g, info }) => ({ name: g.name, host: g.host, model: g.model, vision: g.vision, up: !!info, health: healthFor(g.name) })),
  };
}

const server = http.createServer((req, res) => {
  // Buffer the body first so the async auth check can't race the request stream.
  const _chunks = [];
  req.on('data', (c) => _chunks.push(c));
  req.on('end', () => void handle(req, res, _chunks));
});

async function handle(req, res, chunks) {
  if (req.url !== '/healthz' && !(await authOK(req, req.url))) {
    return json(res, 401, { error: { message: 'invalid or missing API key', type: 'unauthorized' } });
  }
  if (req.url === '/healthz') return json(res, 200, { ok: true });
  if (req.url === '/' || req.url === '/health')
    return poolInfo().then((i) => json(res, 200, i)).catch(() => json(res, 200, { name: 'Off Grid AI — gateway aggregator', routes: POOL }));
  if (req.url === '/traffic' || req.url === '/traffic.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(trafficJSON()));
  }
  if (req.url === '/nodes') {
    return Promise.all(POOL.map(async (g) => {
      const h = healthFor(g.name);
      let installedModels = [];
      try {
        const r = await fetch(`http://${g.host}:${g.port}/v1/models`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          const d = await r.json();
          installedModels = (d.data || []).map((m) => ({ id: m.id.split('/').pop(), meta: m.meta }));
        }
      } catch { /* unreachable */ }
      return { name: g.name, host: g.host, port: g.port, model: g.model, vision: g.vision, health: h, installedModels };
    })).then((nodes) => json(res, 200, { nodes }));
  }
  if (req.url === '/tokens') {
    // Snapshot of the client-token store for the console to persist (ip/token/meta records).
    return json(res, 200, [...TOKENS.values()]);
  }
  if (req.url === '/v1/models') {
    const models = [...new Set(POOL.map((g) => g.model))].map((id) => {
      const nodes = POOL.filter((g) => g.model === id);
      const vision = nodes.some((g) => g.vision);
      return { id, object: 'model', owned_by: 'offgrid', capabilities: vision ? ['text', 'vision'] : ['text'], gateways: nodes.map((g) => g.name) };
    });
    return json(res, 200, { object: 'list', data: models });
  }

  {
    // Record the client's (ip, provider token, meta) on every proxied AI request.
    captureToken(req);
    const raw = Buffer.concat(chunks);
    let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch { /* not json */ }
    const image = hasImage(body);
    const target = pick(body.model, image) || LIVE[0];
    const kind = image ? 'image' : 'text';
    const started = Date.now();
    const streaming = body.stream === true;
    // Request-side context for the observability record (A + D above).
    const caller = String(req.headers['user-agent'] || '').slice(0, 80);
    const corrId = String(req.headers['x-offgrid-run'] || req.headers['x-request-id'] || '');
    const params = {
      temperature: body.temperature,
      maxTokens: body.max_tokens,
      topP: body.top_p,
      thinking: body?.chat_template_kwargs?.enable_thinking !== false,
      toolsOffered: Array.isArray(body.tools) ? body.tools.length : 0,
    };
    const msgs = Array.isArray(body.messages)
      ? body.messages.map((m) => ({
          role: m.role,
          text: (typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.filter((p) => p && p.type === 'text' && p.text).map((p) => p.text).join('\n')
              : ''
          ).slice(0, 600),
        }))
      : [];
    // Gemma 4 (and others) reject system messages not at position 0 — clients
    // like Claude Code intersperse them mid-conversation. Consolidate to front.
    // Handle both string content and multipart array content [{type:"text",text:"..."}].
    let forwarded = raw;
    if (Array.isArray(body.messages)) {
      const sysTexts = []; const rest = [];
      let needsFix = false;
      let seenNonSystem = false;
      for (const m of body.messages) {
        if (m.role === 'system') {
          if (seenNonSystem) needsFix = true; // system after non-system = bad
          let text = '';
          if (typeof m.content === 'string') text = m.content;
          else if (Array.isArray(m.content)) text = m.content.filter(p => p && p.type === 'text' && p.text).map(p => p.text).join('\n');
          if (text.trim()) sysTexts.push(text.trim());
        } else {
          seenNonSystem = true;
          rest.push(m);
        }
      }
      if (needsFix && sysTexts.length > 0) {
        body.messages = [{ role: 'system', content: sysTexts.join('\n\n') }, ...rest];
        forwarded = Buffer.from(JSON.stringify(body));
      } else if (needsFix) {
        // System messages exist mid-conversation but have no extractable text — just remove them
        body.messages = rest;
        forwarded = Buffer.from(JSON.stringify(body));
      }
    }
    const opts = {
      host: target.host, port: target.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: `${target.host}:${target.port}`, 'content-length': forwarded.length }
    };
    const up = http.request(opts, (ur) => {
      res.writeHead(ur.statusCode || 502, { ...ur.headers, 'x-offgrid-gateway': target.name, 'x-offgrid-model': target.model });
      let bytes = 0; const buf = [];
      // Buffer a bounded copy of the response so we can log the completion text (in + out).
      ur.on('data', (c) => { bytes += c.length; res.write(c); if (buf.length < 500) buf.push(c); });
      ur.on('end', () => {
        res.end();
        let tokens = 0; let promptTokens = 0; let completionTokens = 0;
        let output = ''; let reasoning = ''; let finish = ''; let tps = 0;
        let toolCalls = [];
        const rawResp = Buffer.concat(buf).toString();
        try {
          if (streaming) {
            for (const line of rawResp.split('\n')) {
              const t = line.trim();
              if (!t.startsWith('data:')) continue;
              const d = t.slice(5).trim();
              if (d === '[DONE]') continue;
              const ch = JSON.parse(d)?.choices?.[0];
              output += ch?.delta?.content || '';
              reasoning += ch?.delta?.reasoning_content || '';
              if (ch?.finish_reason) finish = ch.finish_reason;
              const tc = ch?.delta?.tool_calls;
              if (Array.isArray(tc)) for (const c of tc) if (c?.function?.name) toolCalls.push({ name: c.function.name, args: (c.function.arguments || '').slice(0, 400) });
            }
          } else {
            const j = JSON.parse(rawResp);
            const ch = j?.choices?.[0];
            tokens = j?.usage?.total_tokens || 0;
            promptTokens = j?.usage?.prompt_tokens || 0;
            completionTokens = j?.usage?.completion_tokens || 0;
            finish = ch?.message?.finish_reason || ch?.finish_reason || '';
            tps = j?.timings?.predicted_per_second ? Math.round(j.timings.predicted_per_second) : 0;
            output = ch?.message?.content || '';
            reasoning = ch?.message?.reasoning_content || '';
            const tc = ch?.message?.tool_calls;
            if (Array.isArray(tc)) toolCalls = tc.map((c) => ({ name: c?.function?.name || '', args: (c?.function?.arguments || '').slice(0, 400) }));
          }
        } catch { /* partial/non-json */ }
        const elapsed = Date.now() - started;
        if (!tps && completionTokens && elapsed > 0) tps = Math.round((completionTokens / elapsed) * 1000);
        record({
          gateway: target.name, model: body.model || target.model, modelServed: target.model, kind,
          status: ur.statusCode || 0, ms: Date.now() - started, bytes, tokens, promptTokens, completionTokens,
          tps, finish, toolCalls, reasoning: reasoning.slice(0, 2000), caller, corrId, params, msgs,
          input: promptText(body), output: output.slice(0, 2000),
        });
      });
    });
    up.on('error', (e) => {
      record({ gateway: target.name, model: body.model || target.model, modelServed: target.model, kind, status: 502, ms: Date.now() - started, bytes: 0, tokens: 0, caller, corrId, params, msgs, input: promptText(body), output: `(error: ${e.message})` });
      json(res, 502, { error: { message: `gateway ${target.name} (${target.host}) error: ${e.message}`, type: 'upstream_error' } });
    });
    up.setTimeout(120000, () => up.destroy(new Error('upstream timeout')));
    up.end(forwarded);
  }
}
server.listen(PORT, '0.0.0.0', () => console.log(`[aggregator] routing on 0.0.0.0:${PORT} across`, POOL.map((g) => `${g.name}:${g.model}${g.vision ? '+vision' : ''}`).join(', ')));
startProbing();
