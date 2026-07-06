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
import { execFile } from 'node:child_process';
import { verifierFromEnv } from './lib/keycloak-verify.mjs';
import { gatewayKeyVerifierFromEnv, isGatewayKey } from './lib/gateway-key-verify.mjs';

// DEPRECATED (task #74): the single static gateway key. Retained ONLY as a backward-compat fallback
// so an unmigrated deploy keeps working; new keys are the Keycloak-backed `ogk_…` API keys minted in
// the console (Gateway → API keys tab), verified via `keyVerifier` below. Remove once every consumer
// has moved to a minted key.
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
const keyVerifier = gatewayKeyVerifierFromEnv(); // Keycloak-backed ogk_ API-key verifier (task #74)
const AUTH_ON = Boolean(API_KEY || kc || keyVerifier);

// Returns true if the request may proceed. /healthz is always open (liveness probe).
// Accepts, in order: a Keycloak-backed `ogk_` API key (many, revocable — the preferred path); the
// DEPRECATED static key (Bearer or x-api-key, backward-compat only); or a Keycloak service JWT.
async function authOK(req, url) {
  if (url === '/healthz') return true;
  if (!AUTH_ON) return true; // no gate configured → open (LAN)
  const hdr = String(req.headers['authorization'] || '');
  const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  const xKey = String(req.headers['x-api-key'] || '');
  // Keycloak-backed API keys — the preferred, revocable path. A key may arrive as x-api-key OR Bearer.
  if (keyVerifier) {
    if (isGatewayKey(xKey) && (await keyVerifier.verify(xKey))) return true;
    if (isGatewayKey(bearer) && (await keyVerifier.verify(bearer))) return true;
  }
  // DEPRECATED static key (backward-compat fallback — see the API_KEY declaration above).
  if (API_KEY && (xKey === API_KEY || bearer === API_KEY)) return true;
  if (kc && bearer) { try { await kc.verify(bearer); return true; } catch { /* fall through */ } }
  return false;
}

const PORT = Number(process.env.PORT || 8800);
const HOST_HINT = process.env.HOST_HINT || '127.0.0.1'; // for display in info URLs only
// role map — one model per gateway (edit IPs via OFFGRID_POOL JSON if they change)
// Hosts are mDNS hostnames (offgrid-gN.local), NOT IPs — so a network/DHCP change (e.g. the
// Airtel_Wednesday migration) never breaks routing. Models reflect what each node currently
// serves; update per-node as model swaps complete.
// `model` is the ROUTING TAG (pick() matches substrings on it); `kind` groups nodes by
// role so chat traffic never lands on an image/grounding node. The card shows each node's
// ACTUAL loaded model (from /v1/models), not this tag — so a mid-swap node reads truthfully.
// LIVE config (2026-07-04 bring-up): all 6 reachable GWs serve chat, from models already on disk.
//   g1 qwythos · g2/g3/g4/g5 gemma-4-e4b · g7 qwythos.
// g6 is now aux SERVER #2 (Colima) — NOT a gateway; g8 is offline (on-site power/wifi). Both
// disabled so pick() never routes to them. Image (g3 juggernaut Q8_0) + VL (g4/g7 UI-Venus) are
// the target roles to restore once a verified image/VL quant lands — flip kind+model back then.
// FALLBACK topology — the last-known-good hardcoded pool. The live pool is fetched
// from the console (fleet_nodes SSOT) by refreshPool(); if that's ever unreachable we
// keep serving from this, so routing can NEVER go down because of the DB/console.
const FALLBACK_POOL = [
  { name: 'g1',  host: 'offgrid-g1.local', port: 7878, vision: true,  kind: 'chat', model: 'qwythos-9b' },
  { name: 'g2',  host: 'offgrid-g2.local', port: 7878, vision: true,  kind: 'chat', model: 'gemma-4-e4b' },
  { name: 'g4',  host: 'offgrid-g4.local', port: 7878, vision: true,  kind: 'chat', model: 'qwen3-vl-8b' },
  { name: 'g5',  host: 'offgrid-g5.local', port: 7878, vision: true,  kind: 'chat', model: 'gemma-4-e4b' },
  { name: 'g7',  host: 'offgrid-g7.local', port: 7878, vision: true,  kind: 'chat', model: 'qwen3-vl-8b' },
  { name: 'g8',  host: 'offgrid-g8.local', port: 7878, vision: true,  kind: 'chat', model: 'qwythos-9b' },
];
const FALLBACK_IMAGE_POOL = [{ name: 'g3', host: 'offgrid-g3.local', port: 1234, model: 'juggernaut-xl-v9' }];

// Live, refreshable pools (let, not const — refreshPool() reassigns). OFFGRID_POOL /
// OFFGRID_IMAGE_POOL env still override (highest precedence) for pinned/dev setups.
let POOL = JSON.parse(process.env.OFFGRID_POOL || JSON.stringify(FALLBACK_POOL));
let IMAGE_POOL = JSON.parse(process.env.OFFGRID_IMAGE_POOL || JSON.stringify(FALLBACK_IMAGE_POOL));
let LIVE = POOL.filter((g) => g.enabled !== false);       // only route to enabled gateways
let IMAGE_LIVE = IMAGE_POOL.filter((g) => g.enabled !== false);

// The fleet_nodes SSOT lives in the console DB; the console derives the routing pools at
// GET /api/v1/gateway/pool. We pull them here on startup + on an interval. Pinned env
// (OFFGRID_POOL) wins and disables the pull, so nothing surprises a manual override.
const POOL_SRC = process.env.OFFGRID_POOL_URL || 'http://127.0.0.1:3000/api/v1/gateway/pool';
const POOL_REFRESH_MS = Number(process.env.OFFGRID_POOL_REFRESH_MS || 30000);
async function refreshPool() {
  if (process.env.OFFGRID_POOL) return; // explicit pin — don't override
  try {
    // Bearer (not x-api-key): the console middleware lets any /api/* request with an
    // `Authorization: Bearer` header through to the handler (which does its own auth); /pool
    // is gate-less read-only topology. x-api-key alone gets a 401 at the middleware.
    const r = await fetch(POOL_SRC, { headers: API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return; // keep current pools on any non-200 (fallback stays live)
    const d = await r.json();
    if (Array.isArray(d?.pool) && d.pool.length) {
      POOL = d.pool;
      LIVE = POOL.filter((g) => g.enabled !== false);
    }
    if (Array.isArray(d?.imagePool)) {
      IMAGE_POOL = d.imagePool;
      IMAGE_LIVE = IMAGE_POOL.filter((g) => g.enabled !== false);
    }
  } catch { /* console/DB unreachable → keep last-known-good pools */ }
}

// Node control (model swap / restart) runs FROM here — the aggregator is on S1 and CAN
// reach the LAN nodes (the console, a user LaunchAgent, is blocked by Local Network
// privacy). Uses S1's default ssh key (~/.ssh/id_ed25519, already trusted by every node).
// Explicit -i key + known_hosts: the launchd process has no HOME, so ssh can't find
// ~/.ssh by default → "Permission denied (publickey)". S1's id_ed25519 is trusted by
// every node. Override the key path via OFFGRID_SSH_KEY if it ever moves.
const SSH_KEY = process.env.OFFGRID_SSH_KEY || '/Users/admin/.ssh/id_ed25519';
function sshExec(host, cmd) {
  return new Promise((resolve) => {
    execFile('ssh', ['-i', SSH_KEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'UserKnownHostsFile=/Users/admin/.ssh/known_hosts', '-o', 'ConnectTimeout=12', `admin@${host}`, cmd],
      { timeout: 90000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.slice(0, 600) }));
  });
}
// Write active-model.json (base64 to dodge SSH quoting) + kickstart the node's gateway.
function applyNodeModel(host, cfg) {
  const b64 = Buffer.from(JSON.stringify(cfg)).toString('base64');
  return sshExec(host, `echo ${b64} | base64 -d > ~/.offgrid/models/active-model.json && launchctl kickstart -k gui/$(id -u)/co.getoffgridai.gateway`);
}
function restartNode(host) {
  return sshExec(host, 'launchctl kickstart -k gui/$(id -u)/co.getoffgridai.gateway');
}

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

  const recentSuccess = recent.some((e) => e.status && e.status < 400);

  // Process unreachable (probe says so, and no successful recent traffic contradicts it) ⇒ down.
  if (probeFresh && !p.reachable && !recentSuccess) return 'down';

  const errs = recent.filter((e) => !e.status || e.status >= 400).length;
  const errRate = recent.length ? errs / recent.length : 0;
  const avgMs = recent.length ? recent.reduce((a, e) => a + (e.ms || 0), 0) / recent.length : 0;

  // Real successful traffic is the ground truth — a node completing real requests is UP,
  // even if it's busy enough that the synthetic 1-token probe timed out. Errors still count.
  if (recentSuccess && errRate < DEGRADED_ERR_RATE) return 'up';

  // Live-traffic error/latency signals (only meaningful with samples in the window).
  if (recent.length >= 2) {
    if (errRate >= DOWN_ERR_RATE || avgMs >= JAM_MS) return 'down';
    if (errRate >= DEGRADED_ERR_RATE || avgMs >= SLOW_MS) return 'degraded';
  }

  // Synthetic-probe signals only apply to an IDLE node (no recent traffic to compete with).
  // A failed gen probe on a busy node means "busy", not "down" — don't penalise it.
  if (probeFresh && p.reachable && !recent.length) {
    if (p.genOk === false) return 'down';           // idle + can't generate 1 token ⇒ jammed
    if (p.genMs != null && p.genMs >= SLOW_MS) return 'degraded';
  }

  if (probeFresh && p.reachable) return 'up';
  if (recentSuccess) return 'up';
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
    // If the node is busy serving real requests, DON'T fire a synthetic gen probe — it would
    // queue behind live traffic and falsely time out. Reachable + real traffic = health handles it.
    const now = Date.now();
    const busy = LOG.some((e) => e.gateway === g.name && now - e.ts <= HEALTH_WINDOW_MS);
    if (busy) { PROBE[g.name] = { reachable: true, genOk: null, genMs: null, ts: Date.now() }; return; }
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
  const chat = LIVE.filter((g) => (g.kind ?? 'chat') === 'chat'); // never route chat to image/grounding
  const byModel = (tag) => chat.filter((g) => g.model.includes(tag));
  // Explicit UI-grounding request → the grounding pool (UI-Venus).
  if (m.includes('venus') || m.includes('grounding')) {
    const ground = LIVE.filter((g) => g.kind === 'grounding');
    if (ground.length) return rrPick(ground);
  }
  if (image) { // multimodal (vision INPUT) — a vision-capable chat node, not image-gen
    if (m.includes('vl'))    return rrPick(chat.filter((g) => g.model.includes('vl') && g.vision));
    if (m.includes('gemma')) return rrPick(chat.filter((g) => g.model.includes('gemma') && g.vision));
    return rrPick(chat.filter((g) => g.vision));
  }
  if (m.includes('vl'))      return rrPick(byModel('vl'));       // Qwen3-VL vision model → g4/g7 (before qwen→gemma)
  if (m.includes('gemma'))   return rrPick(byModel('gemma'));
  if (m.includes('qwen'))    return rrPick(byModel('gemma'));   // legacy qwen (non-VL) retired → gemma
  if (m.includes('qwythos')) return rrPick(byModel('qwythos'));
  return rrPick(chat); // unspecified: round-robin CHAT nodes only
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
// Turn a llama.cpp model id (an absolute .gguf path) into a readable tag, e.g.
// "/…/UI-Venus-1.5-8B-Q4_K_M.gguf" -> "UI-Venus-1.5-8B". Drops the dir, the .gguf
// extension, and a trailing quant token so the card shows the model, not the file.
function prettyModel(idPath) {
  if (!idPath || typeof idPath !== 'string') return null;
  const base = idPath.split('/').pop().replace(/\.gguf$/i, '');
  return base.replace(/-(Q\d[\w.]*|IQ\d[\w.]*|F16|BF16|F32)$/i, '');
}

async function poolInfo() {
  const infos = await Promise.all(POOL.map(async (g) => {
    try {
      // Fetch the node's info AND its actual loaded model in parallel, so the card reflects
      // what each node is really serving (truthful mid-swap), not the static routing tag.
      const [r, mr] = await Promise.all([
        fetch(`http://${g.host}:${g.port}/`, { signal: AbortSignal.timeout(1500) }),
        fetch(`http://${g.host}:${g.port}/v1/models`, { signal: AbortSignal.timeout(1500) }).catch(() => null),
      ]);
      // Seed reachability if we've never probed this gateway, so health isn't 'unknown' on cold start.
      if (!PROBE[g.name]) PROBE[g.name] = { reachable: r.ok, genOk: null, genMs: null, ts: Date.now() };
      let loaded = null;
      if (mr && mr.ok) { try { loaded = prettyModel((await mr.json())?.data?.[0]?.id); } catch { /* keep null */ } }
      return { g, info: r.ok ? await r.json() : null, loaded };
    } catch { if (!PROBE[g.name]) PROBE[g.name] = { reachable: false, genOk: null, genMs: null, ts: Date.now() }; return { g, info: null, loaded: null }; }
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
    image_models: IMAGE_LIVE.map((g) => ({ id: g.model, gateways: [g.name] })),
    gateways: infos.map(({ g, info, loaded }) => ({ name: g.name, host: g.host, model: loaded ?? g.model, vision: g.vision, up: !!info, health: healthFor(g.name) })),
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
  // Read-only runtime TUNING snapshot — the actual values this process is running with.
  // Every knob here is set from process env in the launchd plist on S1 and requires an
  // aggregator restart (launchctl kickstart) to change — so this is honestly READ-ONLY;
  // the aggregator has no live-reconfigure endpoint. No secrets are exposed. The console's
  // Gateway "Tuning" tab renders this. Routing (POOL) is edited via the fleet SSOT, not here.
  if (req.url === '/config') {
    return json(res, 200, {
      readonly: true,
      // How the router picks nodes, refreshes the pool, and what it falls back to.
      routing: {
        poolSource: POOL_SRC,
        poolRefreshMs: POOL_REFRESH_MS,
        poolPinned: Boolean(process.env.OFFGRID_POOL), // OFFGRID_POOL env pin disables SSOT refresh
        liveNodes: LIVE.length,
        poolNodes: POOL.length,
        imageLiveNodes: IMAGE_LIVE.length,
        fallbackPoolNodes: FALLBACK_POOL.length, // hardcoded last-known-good if SSOT unreachable
      },
      // TRUE-inference health thresholds (see healthFor()).
      health: {
        probeEnabled: PROBE_ENABLED,
        windowMs: HEALTH_WINDOW_MS,
        slowMs: SLOW_MS,
        jamMs: JAM_MS,
        degradedErrRate: DEGRADED_ERR_RATE,
        downErrRate: DOWN_ERR_RATE,
        probeEveryMs: PROBE_EVERY,
        probeTimeoutMs: PROBE_TIMEOUT,
      },
      // Upstream request timeouts (per proxied call).
      timeouts: {
        chatUpstreamMs: Number(process.env.OFFGRID_GATEWAY_UPSTREAM_TIMEOUT_MS || 300000),
        imageUpstreamMs: Number(process.env.OFFGRID_IMAGE_UPSTREAM_TIMEOUT_MS || 300000),
      },
      // Honest capability flags — features the aggregator does NOT have, so the console
      // never renders a fake control for them.
      capabilities: {
        responseCache: false,          // no response/prompt cache in the router
        perRequestFallbackChain: false, // no model→model fallback; only the pool + hardcoded FALLBACK_POOL
        rateLimit: false,               // rate-limit + WAF live at the Caddy edge / console middleware, by design
        liveReconfigure: false,         // knobs are env-set on S1; restart to change
      },
    });
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
  // CONTROL: POST /nodes/<name> — the console (via fleet_nodes SSOT) drives node changes here.
  //   { action:'activate', id, primary, mmproj?, ctx? } → write active-model.json + kickstart (SSH)
  //   { action:'restart' }                             → kickstart the node's gateway (SSH)
  //   { action:'enable'|'disable' }                    → console already persisted the flag in the
  //                                                       SSOT; we just refresh so routing follows.
  {
    const m = req.url.match(/^\/nodes\/([^/?]+)$/);
    if (m && req.method === 'POST') {
      const name = decodeURIComponent(m[1]);
      const node = [...POOL, ...IMAGE_POOL].find((g) => g.name === name);
      if (!node) return json(res, 404, { error: `node "${name}" not in pool` });
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* non-json */ }
      if (body.action === 'activate') {
        if (!body.id || !body.primary) return json(res, 400, { error: 'activate needs id + primary (gguf)' });
        const cfg = { id: body.id, primary: body.primary };
        if (body.mmproj) cfg.mmproj = body.mmproj;
        if (body.ctx) cfg.ctx = body.ctx;
        const r = await applyNodeModel(node.host, cfg);
        await refreshPool();
        return json(res, r.ok ? 200 : 502, { ok: r.ok, node: name, applied: cfg, output: r.out });
      }
      if (body.action === 'restart') {
        const r = await restartNode(node.host);
        return json(res, r.ok ? 200 : 502, { ok: r.ok, node: name, output: r.out });
      }
      if (body.action === 'enable' || body.action === 'disable') {
        await refreshPool(); // SSOT already updated by the console; adopt it now
        return json(res, 200, { ok: true, node: name, action: body.action, note: 'pool refreshed from SSOT' });
      }
      return json(res, 400, { error: 'action must be activate|restart|enable|disable' });
    }
  }
  if (req.url === '/tokens') {
    // Snapshot of the client-token store for the console to persist (ip/token/meta records).
    return json(res, 200, [...TOKENS.values()]);
  }
  if (req.url === '/v1/models') {
    const models = [...new Set(LIVE.map((g) => g.model))].map((id) => {
      const nodes = LIVE.filter((g) => g.model === id);
      const vision = nodes.some((g) => g.vision);
      return { id, object: 'model', owned_by: 'offgrid', capabilities: vision ? ['text', 'vision'] : ['text'], gateways: nodes.map((g) => g.name) };
    });
    const imageModels = IMAGE_LIVE.map((g) => ({ id: g.model, object: 'model', owned_by: 'offgrid', capabilities: ['image-generation'], gateways: [g.name] }));
    return json(res, 200, { object: 'list', data: [...models, ...imageModels] });
  }

  if (req.url.startsWith('/v1/images/')) {
    // Image generation/edit → sd-server (OpenAI-compatible) on an image node. Straight proxy.
    captureToken(req);
    const raw = Buffer.concat(chunks);
    const target = IMAGE_LIVE.length ? rrPick(IMAGE_LIVE) : null;
    if (!target) return json(res, 503, { error: { message: 'no image gateway available', type: 'no_backend' } });
    const started = Date.now();
    let prompt = ''; try { prompt = String(JSON.parse(raw.toString() || '{}').prompt || ''); } catch { /* non-json */ }
    const caller = String(req.headers['user-agent'] || '').slice(0, 80);
    const opts = { host: target.host, port: target.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: `${target.host}:${target.port}`, 'content-length': raw.length } };
    const up = http.request(opts, (ur) => {
      res.writeHead(ur.statusCode || 502, { ...ur.headers, 'x-offgrid-gateway': target.name, 'x-offgrid-model': target.model });
      let bytes = 0;
      ur.on('data', (c) => { bytes += c.length; res.write(c); });
      ur.on('end', () => { res.end(); record({ gateway: target.name, model: target.model, modelServed: target.model, kind: 'image', status: ur.statusCode || 0, ms: Date.now() - started, bytes, tokens: 0, caller, corrId: '', params: {}, msgs: [], input: prompt.slice(0, 600), output: `(image ${bytes} bytes)` }); });
    });
    up.on('error', (e) => {
      record({ gateway: target.name, model: target.model, modelServed: target.model, kind: 'image', status: 502, ms: Date.now() - started, bytes: 0, tokens: 0, caller, corrId: '', params: {}, msgs: [], input: prompt.slice(0, 600), output: `(error: ${e.message})` });
      json(res, 502, { error: { message: `image gateway ${target.name} (${target.host}) error: ${e.message}`, type: 'upstream_error' } });
    });
    up.setTimeout(Number(process.env.OFFGRID_IMAGE_UPSTREAM_TIMEOUT_MS || 300000), () => up.destroy(new Error('upstream timeout')));
    return up.end(raw);
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
    up.setTimeout(Number(process.env.OFFGRID_GATEWAY_UPSTREAM_TIMEOUT_MS || 300000), () => up.destroy(new Error('upstream timeout')));
    up.end(forwarded);
  }
}
server.listen(PORT, '0.0.0.0', () => console.log(`[aggregator] routing on 0.0.0.0:${PORT} across`, POOL.map((g) => `${g.name}:${g.model}${g.vision ? '+vision' : ''}`).join(', ')));

// Pull the live pool from the fleet_nodes SSOT (console) on startup + on an interval.
// Fallback pools keep serving until/if the first pull succeeds, so startup never blocks.
refreshPool().then(() => console.log('[aggregator] pool after SSOT refresh:', LIVE.map((g) => `${g.name}:${g.model}`).join(', ')));
setInterval(refreshPool, POOL_REFRESH_MS).unref();
startProbing();
