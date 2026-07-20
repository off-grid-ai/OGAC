// Off Grid guardrail aggregator — ONE LLM Guard `/analyze/prompt` endpoint that fans a prompt out
// across a POOL of scanner SHARDS and merges their verdicts. Dependency-free (Node http).
// Runs on S1 as a LaunchAgent, mirroring scripts/gateway-aggregator.mjs.
//
// WHY: the full LLM Guard scanner suite (Anonymize/PII + PromptInjection + Toxicity + …) needs
// ~5–6 GB and OOMs a single fleet OrbStack VM (capped at 7.8 GB, already running the data stack).
// So we SHARD the scanners across nodes — S1 runs the PII/DLP + substrings shard, S2 runs the heavy
// transformer classifiers — and this aggregator presents them to the console as one engine. The
// console's guardrail adapter (src/lib/adapters/guardrail-provider.ts) is unchanged: it still POSTs
// { prompt, scanners } to /analyze/prompt and reads { is_valid, scanners, sanitized_prompt }.
//
// The MERGE POLICY is the pure, unit-tested scripts/lib/guard-merge.mjs. This file is the thin I/O
// shell: fan-out fetch, timeout, auth, fail-closed-vs-degrade, health.
//
// FAIL CLOSED: a REQUIRED shard that is unreachable ⇒ 502 here ⇒ the console blocks the run (a
// guardrail must not be bypassable by killing its engine). An OPTIONAL shard down ⇒ the verdict
// stands on the shards that answered, and the response carries `x-offgrid-guard-degraded`.
import http from 'node:http';
import { mergeGuardResponses } from './lib/guard-merge.mjs';

const PORT = Number(process.env.PORT || 8010);
const UPSTREAM_TIMEOUT_MS = Number(process.env.OFFGRID_GUARD_TIMEOUT_MS || 8000);
// The token the CONSOLE presents (its OFFGRID_HTTP_GUARDRAIL_API_KEY). If unset, the endpoint is
// open on loopback (the default: the aggregator binds 127.0.0.1 on S1).
const AGG_TOKEN = process.env.OFFGRID_GUARD_AGGREGATOR_TOKEN || '';
const BIND = process.env.OFFGRID_GUARD_BIND || '127.0.0.1';

// SHARDS — JSON array of { name, url, token?, required? } via OFFGRID_GUARD_SHARDS. Each `url` is an
// llm-guard-api base. `required` shards fail the whole request closed when down; optional shards
// degrade. Default: the on-box PII shard (required) + the S2 classifier shard over a loopback fwd
// (optional, so an S2 hiccup never takes governed runs offline — PII stays authoritative on-box).
const DEFAULT_SHARDS = [
  { name: 'pii', url: 'http://127.0.0.1:8000', required: true },
  { name: 'classifiers', url: 'http://127.0.0.1:8001', required: false },
];
let SHARDS = DEFAULT_SHARDS;
try {
  if (process.env.OFFGRID_GUARD_SHARDS) {
    const parsed = JSON.parse(process.env.OFFGRID_GUARD_SHARDS);
    if (Array.isArray(parsed) && parsed.length) SHARDS = parsed;
  }
} catch (e) {
  console.error('[guard-agg] bad OFFGRID_GUARD_SHARDS JSON, using defaults:', e.message);
}
// Per-shard bearer tokens may also arrive out-of-band as OFFGRID_GUARD_TOKEN_<NAME> so the pool JSON
// need not carry secrets.
for (const s of SHARDS) {
  const envTok = process.env[`OFFGRID_GUARD_TOKEN_${String(s.name || '').toUpperCase()}`];
  if (envTok && !s.token) s.token = envTok;
}

function trimSlash(u) {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

// fetch() hides ECONNREFUSED/ETIMEDOUT on err.cause.code — surface it (matches the console adapter).
function describeError(err) {
  const cause = err && err.cause;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  return code ? `${err.message} (cause: ${code})` : String(err && err.message ? err.message : err);
}

function isUsableVerdict(body, phase) {
  return (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    typeof body.is_valid === 'boolean' &&
    body.scanners &&
    typeof body.scanners === 'object' &&
    !Array.isArray(body.scanners) &&
    Object.values(body.scanners).every((score) => typeof score === 'number' && Number.isFinite(score)) &&
    (phase === 'output'
      ? typeof body.sanitized_output === 'string'
      : typeof body.sanitized_prompt === 'string')
  );
}

// POST the prompt to one shard's /analyze/prompt. Returns { name, required, ok, status, body }.
async function callShard(shard, payload, phase) {
  const headers = { 'content-type': 'application/json' };
  if (shard.token) headers.authorization = `Bearer ${shard.token}`;
  try {
    const endpoint = phase === 'output' ? 'output' : 'prompt';
    const res = await fetch(`${trimSlash(shard.url)}/analyze/${endpoint}`, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-json body ⇒ treat as no verdict */
    }
    const usable = isUsableVerdict(body, phase);
    if (!res.ok) console.error(`[guard-agg] shard ${shard.name} HTTP ${res.status}`);
    else if (!usable) console.error(`[guard-agg] shard ${shard.name} returned a malformed verdict`);
    return {
      name: shard.name,
      required: !!shard.required,
      ok: res.ok && usable,
      status: res.status,
      body,
    };
  } catch (err) {
    console.error(`[guard-agg] shard ${shard.name} unreachable:`, describeError(err));
    return { name: shard.name, required: !!shard.required, ok: false, status: 0, body: null };
  }
}

const json = (res, code, obj, extra = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(obj));
};

function authOK(req) {
  if (!AGG_TOKEN) return true; // loopback-only default → open
  const hdr = String(req.headers['authorization'] || '');
  const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  return bearer === AGG_TOKEN;
}

// GET /healthz — aggregator liveness (the console's health() probe). Always 200 while the process is
// up; per-shard reachability is on GET /health.
// GET /health  — per-shard reachability snapshot (which shards answer /healthz right now).
async function shardHealth() {
  const shards = await Promise.all(
    SHARDS.map(async (s) => {
      try {
        const r = await fetch(`${trimSlash(s.url)}/healthz`, { signal: AbortSignal.timeout(2500) });
        return { name: s.name, url: s.url, required: !!s.required, up: r.ok };
      } catch {
        return { name: s.name, url: s.url, required: !!s.required, up: false };
      }
    }),
  );
  const requiredDown = shards.filter((s) => s.required && !s.up).map((s) => s.name);
  return { ok: requiredDown.length === 0, shards, requiredDown };
}

async function handleAnalyze(req, res, chunks, phase) {
  const raw = Buffer.concat(chunks);
  let original = '';
  try {
    const parsed = JSON.parse(raw.toString() || '{}');
    if (!parsed || typeof parsed.prompt !== 'string')
      return json(res, 400, { error: 'prompt must be a string' });
    if (phase === 'output' && typeof parsed.output !== 'string')
      return json(res, 400, { error: 'output must be a string' });
    if ('scanners' in parsed)
      return json(res, 400, {
        error: 'scanner configuration is startup-only; use fleet CONFIG_FILE YAML',
      });
    original = phase === 'output' ? parsed.output : parsed.prompt;
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  // Forward the EXACT body the console sent (it carries { prompt, scanners } — the India recognizers
  // are folded into that scanners config) to every shard, unchanged.
  const results = await Promise.all(SHARDS.map((s) => callShard(s, raw, phase)));
  const { merged, blocked, degraded, answered } = mergeGuardResponses(original, results, phase);
  const extra = {
    'x-offgrid-guard-answered': answered.join(',') || 'none',
  };
  if (degraded.length) extra['x-offgrid-guard-degraded'] = degraded.join(',');
  if (blocked) {
    // A REQUIRED shard is down — refuse so the console fails closed (never a silent fall-open).
    const downRequired = results.filter((r) => r.required && !r.ok).map((r) => r.name);
    console.error('[guard-agg] required shard(s) down → 502 (console fails closed):', downRequired.join(','));
    return json(res, 502, { error: 'guardrail shard unavailable', shards: downRequired }, extra);
  }
  return json(res, 200, merged, extra);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => void route(req, res, chunks));
});

async function route(req, res, chunks) {
  const url = (req.url || '').split('?')[0];
  if (url === '/healthz') return json(res, 200, { ok: true });
  if (url === '/health' || url === '/')
    return shardHealth().then((h) => json(res, 200, { name: 'Off Grid AI — guardrail aggregator', ...h }));
  if (!authOK(req)) return json(res, 401, { error: 'invalid or missing token' });
  if (url === '/analyze/prompt' && req.method === 'POST')
    return handleAnalyze(req, res, chunks, 'input');
  if (url === '/analyze/output' && req.method === 'POST')
    return handleAnalyze(req, res, chunks, 'output');
  return json(res, 404, { error: `no route ${req.method} ${url}` });
}

server.listen(PORT, BIND, () =>
  console.log(
    `[guard-agg] on ${BIND}:${PORT} — shards:`,
    SHARDS.map((s) => `${s.name}${s.required ? '*' : ''}→${s.url}`).join(', '),
  ),
);
