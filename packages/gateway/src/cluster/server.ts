// createClusterGateway — the standalone multinode router/aggregator.
//
// One OpenAI-compatible endpoint fanning out across the node pool by model +
// modality, with true inference health, plug-and-play observability, and a
// multinode model-management surface. Dependency-free (Node http + fetch), so
// it runs headless (the cluster CLI / Docker) and is equally importable by the
// console for its management plane.
import http from 'http';
import { TrafficStore } from './capture';
import { HealthMonitor, healthConfig } from './health';
import { Router, hasImage } from './router';
import { AdmissionLimiter, limiterConfig, Saturated } from './limiter';
import { sinksFromEnv, type ObservabilitySink } from './observability';
import { DASHBOARD_HTML } from './dashboard';
import * as clusterModels from './models';
import { runPre, runPost, type Policy, type PolicyContext } from '../policy/types';
import { getValidator, keycloakConfigFromEnv } from './keycloak';
import type { TokenStore } from '../policy/client-auth';
// TokenStore used only for the /tokens endpoint shape — no runtime dep on client-auth.
import type { ClusterOptions, GatewayNode, TrafficRecord } from './types';

const DEFAULT_POOL: GatewayNode[] = [
  { name: 'g1', host: '127.0.0.1', port: 7878, vision: true, model: 'default' },
];

function resolvePool(pool?: GatewayNode[]): GatewayNode[] {
  if (pool?.length) return pool;
  if (process.env.OFFGRID_POOL) {
    try {
      return JSON.parse(process.env.OFFGRID_POOL) as GatewayNode[];
    } catch {
      /* fall through to default */
    }
  }
  return DEFAULT_POOL;
}

const json = (res: http.ServerResponse, code: number, obj: unknown): void => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
};

// Last user turn, for the traffic log (so you can see what went in).
function promptText(body: { messages?: unknown }): string {
  const msgs = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
  const c = lastUser?.content;
  const text =
    typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? c.filter((p) => p && (p as { type?: string }).type === 'text' && (p as { text?: string }).text).map((p) => (p as { text: string }).text).join('\n')
        : '';
  return text.slice(0, 2000);
}

// Gemma 4 (and others) reject system messages not at position 0 — clients like
// Claude Code intersperse them. Consolidate any stray system turns to the front.
function normalizeMessages(raw: Buffer, body: { messages?: { role?: string; content?: unknown }[] }): Buffer {
  if (!Array.isArray(body.messages)) return raw;
  const sysTexts: string[] = [];
  const rest: unknown[] = [];
  let needsFix = false;
  let seenNonSystem = false;
  for (const m of body.messages) {
    if (m.role === 'system') {
      if (seenNonSystem) needsFix = true;
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content))
        text = m.content.filter((p) => p && (p as { type?: string }).type === 'text' && (p as { text?: string }).text).map((p) => (p as { text: string }).text).join('\n');
      if (text.trim()) sysTexts.push(text.trim());
    } else {
      seenNonSystem = true;
      rest.push(m);
    }
  }
  if (!needsFix) return raw;
  body.messages = (sysTexts.length ? [{ role: 'system', content: sysTexts.join('\n\n') }, ...rest] : rest) as typeof body.messages;
  return Buffer.from(JSON.stringify(body));
}

// All env-var-backed settings the gateway exposes for live inspection + admin override.
// `secret` = value is masked in GET (write-only from the console). `liveReload` = can
// be applied without a restart via POST /config.
export const GATEWAY_CONFIG_SCHEMA = [
  // ── Networking ──────────────────────────────────────────────────────────────
  { key: 'OFFGRID_CLUSTER_PORT', group: 'Networking', label: 'Listen port', type: 'number', liveReload: false, secret: false, description: 'Port the cluster gateway listens on. Requires restart.' },
  { key: 'OFFGRID_CLUSTER_HOST', group: 'Networking', label: 'Listen host', type: 'string', liveReload: false, secret: false, description: 'Bind address (0.0.0.0 = all interfaces). Requires restart.' },
  { key: 'HOST_HINT', group: 'Networking', label: 'Host hint', type: 'string', liveReload: false, secret: false, description: 'IP shown in info URLs (display only).' },
  // ── Auth ────────────────────────────────────────────────────────────────────
  { key: 'OFFGRID_GATEWAY_API_KEY', group: 'Auth', label: 'Gateway API key', type: 'string', liveReload: false, secret: true, description: 'Static Bearer/x-api-key accepted on all non-healthz routes (console + automation). Unset = open (LAN only).' },
  { key: 'OFFGRID_KEYCLOAK_URL', group: 'Auth', label: 'Keycloak URL', type: 'string', liveReload: false, secret: false, description: 'Keycloak base URL, e.g. https://sso.example.com. Enables JWT validation for human + machine clients.' },
  { key: 'OFFGRID_KEYCLOAK_REALM', group: 'Auth', label: 'Keycloak realm', type: 'string', liveReload: false, secret: false, description: 'Keycloak realm name, e.g. offgrid.' },
  { key: 'OFFGRID_KEYCLOAK_CLIENT_ID', group: 'Auth', label: 'Keycloak client ID', type: 'string', liveReload: false, secret: false, description: 'Expected audience (aud/azp) in gateway-bound JWTs. Leave blank to skip audience check.' },
  // ── Observability ───────────────────────────────────────────────────────────
  { key: 'OFFGRID_RAW_HEADERS', group: 'Observability', label: 'Raw header logging', type: 'boolean', liveReload: true, secret: false, description: 'Log all inbound request + upstream response headers on every call. Toggle without restart.' },
  { key: 'OFFGRID_OPENSEARCH_URL', group: 'Observability', label: 'OpenSearch URL', type: 'string', liveReload: false, secret: false, description: 'Base URL of the OpenSearch instance for durable call logging.' },
  { key: 'OFFGRID_GATEWAY_INDEX', group: 'Observability', label: 'OpenSearch index', type: 'string', liveReload: false, secret: false, description: 'Index name for gateway call documents. Default: offgrid-gateway.' },
  { key: 'OFFGRID_LANGFUSE_URL', group: 'Observability', label: 'Langfuse URL', type: 'string', liveReload: false, secret: false, description: 'Langfuse ingestion endpoint for LLM-native tracing.' },
  { key: 'OFFGRID_LANGFUSE_PUBLIC_KEY', group: 'Observability', label: 'Langfuse public key', type: 'string', liveReload: false, secret: false, description: 'Langfuse project public key.' },
  { key: 'OFFGRID_LANGFUSE_SECRET_KEY', group: 'Observability', label: 'Langfuse secret key', type: 'string', liveReload: false, secret: true, description: 'Langfuse project secret key.' },
  // ── Admission control ───────────────────────────────────────────────────────
  { key: 'OFFGRID_MAX_CONCURRENT_PER_NODE', group: 'Admission control', label: 'Max concurrent per node', type: 'number', liveReload: true, secret: false, description: 'Max in-flight requests per node before queuing begins.' },
  { key: 'OFFGRID_MAX_QUEUE_PER_NODE', group: 'Admission control', label: 'Max queue per node', type: 'number', liveReload: true, secret: false, description: 'Max requests waiting per node; beyond this the gateway 503s.' },
  { key: 'OFFGRID_QUEUE_TIMEOUT_MS', group: 'Admission control', label: 'Queue timeout (ms)', type: 'number', liveReload: true, secret: false, description: 'How long a queued request waits before being rejected.' },
  // ── Health ──────────────────────────────────────────────────────────────────
  { key: 'OFFGRID_HEALTH_WINDOW_MS', group: 'Health', label: 'Health window (ms)', type: 'number', liveReload: false, secret: false, description: 'Rolling window over which error rate + latency are computed.' },
  { key: 'OFFGRID_HEALTH_SLOW_MS', group: 'Health', label: 'Slow threshold (ms)', type: 'number', liveReload: false, secret: false, description: 'P50 latency above this → degraded.' },
  { key: 'OFFGRID_HEALTH_JAM_MS', group: 'Health', label: 'Jam threshold (ms)', type: 'number', liveReload: false, secret: false, description: 'P50 latency above this → down (KV-cache jam).' },
  { key: 'OFFGRID_HEALTH_ERR_RATE', group: 'Health', label: 'Degraded error rate', type: 'number', liveReload: false, secret: false, description: 'Error rate (0–1) above which a node is degraded.' },
  { key: 'OFFGRID_HEALTH_DOWN_ERR_RATE', group: 'Health', label: 'Down error rate', type: 'number', liveReload: false, secret: false, description: 'Error rate (0–1) above which a node is marked down.' },
  { key: 'OFFGRID_HEALTH_PROBE', group: 'Health', label: 'Probe enabled', type: 'boolean', liveReload: false, secret: false, description: 'Run a 1-token probe on idle nodes to catch jams without live traffic.' },
  { key: 'OFFGRID_HEALTH_PROBE_MS', group: 'Health', label: 'Probe interval (ms)', type: 'number', liveReload: false, secret: false, description: 'How often to probe idle nodes.' },
  { key: 'OFFGRID_HEALTH_PROBE_TIMEOUT_MS', group: 'Health', label: 'Probe timeout (ms)', type: 'number', liveReload: false, secret: false, description: 'Max wait for a probe response before marking the node down.' },
] as const;

export type GatewayConfigKey = (typeof GATEWAY_CONFIG_SCHEMA)[number]['key'];

export interface ClusterGateway {
  server: http.Server;
  pool: GatewayNode[];
  live: GatewayNode[];
  traffic: TrafficStore;
  health: HealthMonitor;
  /** Snapshot for the /traffic view + console management plane. */
  trafficJSON(): unknown;
  /** Merged pool info (modalities + per-node health) for the / and /health views. */
  poolInfo(): Promise<unknown>;
  listen(): ClusterGateway;
  close(): void;
}

// eslint-disable-next-line complexity, max-statements
export function createClusterGateway(opts: ClusterOptions = {}): ClusterGateway {
  const pool = resolvePool(opts.pool);
  const live = pool.filter((g) => g.enabled !== false);
  const port = opts.port ?? Number(process.env.OFFGRID_CLUSTER_PORT || process.env.PORT || 8800);
  const host = opts.host ?? process.env.OFFGRID_CLUSTER_HOST ?? '0.0.0.0';
  const hostHint = opts.hostHint ?? process.env.HOST_HINT ?? '127.0.0.1';

  // Observability is plug-and-play: explicit sinks win; else derive from env
  // (OpenSearch + Langfuse if configured, always stdout). openSearchUrl is a
  // convenience that layers an OpenSearch sink on top.
  const sinks: ObservabilitySink[] = [...sinksFromEnv(), ...(opts.sinks ?? [])];
  const policies: Policy[] = opts.policies ?? [];
  // Live-reloadable settings — mutable so POST /config can update them at runtime.
  let rawHeaders = opts.rawHeaders ?? process.env.OFFGRID_RAW_HEADERS === 'true';
  const kcCfg = keycloakConfigFromEnv();
  // If any policy is the client-auth plugin, grab its token store so we can
  // expose it at /tokens for the console to sync and persist.
  const tokenStore: TokenStore | undefined = (policies.find((p) => p.name === 'client-auth') as { tokens?: TokenStore } | undefined)?.tokens;
  // Optional API-key gate on the OpenAI-compatible + management surface. When set
  // (env OFFGRID_GATEWAY_API_KEY), /v1/* and /nodes require Bearer/x-api-key —
  // so the endpoint is safe to expose (e.g. via a Cloudflare tunnel). Unset ⇒ open (LAN).
  const apiKey = process.env.OFFGRID_GATEWAY_API_KEY;
  const cfg = healthConfig(opts.health);
  const traffic = new TrafficStore(sinks);
  const health = new HealthMonitor(traffic, cfg);
  const router = new Router(live);
  const limiter = new AdmissionLimiter(limiterConfig());

  const trafficJSON = (): unknown => ({
    since: new Date(traffic.startedAt).toISOString(),
    pool: pool.map((g) => ({ name: g.name, model: g.model, vision: g.vision })),
    stats: pool.map((g) =>
      traffic.statsFor(g.name, g.model, health.healthFor(g.name), {
        inflight: limiter.inflight(g.name),
        queued: limiter.queued(g.name),
        peakInflight: limiter.peak(g.name),
      }),
    ),
    recent: traffic.recent(),
  });

  const poolInfo = async (): Promise<unknown> => {
    const infos = await Promise.all(
      pool.map(async (g) => {
        try {
          const r = await fetch(`http://${g.host}:${g.port}/`, { signal: AbortSignal.timeout(1500) });
          health.seed(g.name, r.ok);
          return { g, info: r.ok ? await r.json() : null };
        } catch {
          health.seed(g.name, false);
          return { g, info: null as unknown };
        }
      }),
    );
    const modalities: Record<string, string> = {};
    for (const { info } of infos)
      for (const [k, v] of Object.entries((info as { modalities?: Record<string, string> })?.modalities || {}))
        if (v === 'ready' || !modalities[k]) modalities[k] = v;
    return {
      name: 'Off Grid AI — gateway cluster',
      openai_compatible: true,
      base_url: `http://${hostHint}:${port}/v1`,
      modalities: Object.keys(modalities).length ? modalities : { text: 'ready', vision_understanding: 'ready' },
      gateways: infos.map(({ g, info }) => ({ name: g.name, host: g.host, model: g.model, vision: g.vision, up: !!info, health: health.healthFor(g.name) })),
    };
  };

  // Async gate: static API key OR valid Keycloak JWT.
  const checkAuth = async (req: http.IncomingMessage): Promise<boolean> => {
    if (!apiKey && !kcCfg) return true; // no gate configured
    const auth = String(req.headers['authorization'] || '');
    const xApiKey = String(req.headers['x-api-key'] || '');
    const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (apiKey && (xApiKey === apiKey || bearerToken === apiKey)) return true;
    if (kcCfg && bearerToken) {
      try { await getValidator(kcCfg).verify(bearerToken); return true; } catch { /* */ }
    }
    return false;
  };

  // eslint-disable-next-line complexity, max-statements
  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse, url: string, wantsHtml: boolean): void => {
    // Browsers get the built-in dashboard; API clients get JSON pool info.
    if ((url === '/' && wantsHtml) || url === '/dashboard') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end(DASHBOARD_HTML);
    }
    if (url === '/' || url === '/health')
      return void poolInfo().then((i) => json(res, 200, i)).catch(() => json(res, 200, { name: 'Off Grid AI — gateway cluster', pool }));
    if (url === '/traffic' || url === '/traffic.json') return void json(res, 200, trafficJSON());
    if (url === '/tokens') {
      if (!tokenStore) return void json(res, 200, []);
      return void json(res, 200, tokenStore.list());
    }

    // ── Gateway config (/config) ─────────────────────────────────────────────
    // GET  → current values of every known config key (secrets masked as '***').
    // POST → apply one or more key/value pairs; live-reloadable keys take effect
    //        immediately; others are acknowledged but require a restart.
    if (url === '/config' && req.method === 'GET') {
      const entries = GATEWAY_CONFIG_SCHEMA.map((s) => ({
        ...s,
        value: s.secret ? (process.env[s.key] ? '***' : '') : (process.env[s.key] ?? ''),
        current: s.key === 'OFFGRID_RAW_HEADERS' ? String(rawHeaders) : (process.env[s.key] ?? ''),
      }));
      return void json(res, 200, { entries });
    }
    if (url === '/config' && req.method === 'POST') {
      const cs: Buffer[] = [];
      req.on('data', (c: Buffer) => cs.push(c));
      req.on('end', () => {
        let body: { settings?: Record<string, string> } = {};
        try { body = JSON.parse(Buffer.concat(cs).toString() || '{}'); } catch { /* */ }
        const applied: string[] = [];
        const restartRequired: string[] = [];
        for (const [k, v] of Object.entries(body.settings ?? {})) {
          const schema = GATEWAY_CONFIG_SCHEMA.find((s) => s.key === k);
          if (!schema) continue;
          // Apply to process.env so child code that reads it on demand picks it up.
          process.env[k] = String(v);
          if (schema.liveReload) {
            // Specific live-reload handlers
            if (k === 'OFFGRID_RAW_HEADERS') rawHeaders = v === 'true' || v === '1';
            applied.push(k);
          } else {
            restartRequired.push(k);
          }
        }
        return void json(res, 200, { ok: true, applied, restartRequired });
      });
      return;
    }
    if (url === '/v1/models') {
      const models = [...new Set(pool.map((g) => g.model))].map((id) => {
        const nodes = pool.filter((g) => g.model === id);
        return { id, object: 'model', owned_by: 'offgrid', capabilities: nodes.some((g) => g.vision) ? ['text', 'vision'] : ['text'], gateways: nodes.map((g) => g.name) };
      });
      return void json(res, 200, { object: 'list', data: models });
    }

    // ── Model-management control plane ────────────────────────────────────────
    // The gateway (which CAN reach the node :7878 mgmt APIs) fronts per-node model
    // control, so a host that can't reach the LAN nodes directly (e.g. a console
    // subject to macOS Local Network privacy) drives everything through here.
    if (url === '/nodes' && req.method === 'GET') {
      return void Promise.all(
        pool.map(async (g) => {
          const v = await clusterModels.nodeModels(g);
          return { name: g.name, host: g.host, model: g.model, vision: !!g.vision, health: health.healthFor(g.name), reachable: v.reachable, active: v.active, installed: v.installed, catalogCount: Array.isArray(v.catalog) ? v.catalog.length : 0 };
        }),
      )
        .then((nodes) => json(res, 200, { available: true, nodes }))
        .catch(() => json(res, 200, { available: false, nodes: [] }));
    }
    if (url.startsWith('/nodes/') && req.method === 'POST') {
      const name = decodeURIComponent(url.slice('/nodes/'.length));
      const g = pool.find((p) => p.name === name);
      if (!g) return void json(res, 404, { error: `unknown node ${name}` });
      const cs: Buffer[] = [];
      req.on('data', (c: Buffer) => cs.push(c));
      req.on('end', () => {
        let b: { action?: string; id?: string; kind?: string; settings?: Record<string, unknown> } = {};
        try {
          b = JSON.parse(Buffer.concat(cs).toString() || '{}');
        } catch {
          /* empty */
        }
        const done = (p: Promise<unknown>): void => void p.then((r) => json(res, 200, r)).catch((e) => json(res, 502, { error: (e as Error).message }));
        switch (b.action) {
          case 'activate':
            return b.id ? done(clusterModels.activateModel(g, b.id, b.kind)) : void json(res, 400, { error: 'id required' });
          case 'unload':
            return done(clusterModels.unloadModel(g, b.kind ?? 'text'));
          case 'pull':
            return b.id ? done(clusterModels.pullModel(g, b.id)) : void json(res, 400, { error: 'id required' });
          case 'delete':
            return b.id ? done(clusterModels.deleteModel(g, b.id)) : void json(res, 400, { error: 'id required' });
          case 'settings':
            return done(b.settings ? clusterModels.setSettings(g, b.settings) : clusterModels.getSettings(g));
          default:
            return void json(res, 400, { error: `unknown action ${b.action}` });
        }
      });
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw.toString() || '{}');
      } catch {
        /* not json */
      }
      const image = hasImage(body);
      const target = router.pickLeastLoaded(body.model as string, image, (n) => limiter.load(n)) || live[0];
      if (!target) return void json(res, 503, { error: { message: 'no live gateway in pool', type: 'no_upstream' } });
      const kind: TrafficRecord['kind'] = image ? 'image' : 'text';
      const started = Date.now();
      const streaming = body.stream === true;
      const caller = String(req.headers['user-agent'] || '').slice(0, 80);
      const corrId = String(req.headers['x-offgrid-run'] || req.headers['x-request-id'] || '');
      // Resolve the true client IP: trust X-Forwarded-For from a front proxy, else socket.
      const xForwardedFor = String(req.headers['x-forwarded-for'] || '');
      const clientIp = (xForwardedFor ? xForwardedFor.split(',')[0] : req.socket.remoteAddress || '').trim();
      const params = {
        temperature: body.temperature as number,
        maxTokens: body.max_tokens as number,
        topP: body.top_p as number,
        thinking: (body as { chat_template_kwargs?: { enable_thinking?: boolean } })?.chat_template_kwargs?.enable_thinking !== false,
        toolsOffered: Array.isArray(body.tools) ? body.tools.length : 0,
      };
      const msgs = Array.isArray(body.messages)
        ? (body.messages as { role: string; content: unknown }[]).map((m) => ({
            role: m.role,
            text: (typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? m.content.filter((p) => p && (p as { type?: string }).type === 'text' && (p as { text?: string }).text).map((p) => (p as { text: string }).text).join('\n')
                : ''
            ).slice(0, 600),
          }))
        : [];
      // ── policy layer (middle layer): guardrails / rate limits / budgets / cache ──
      // Runs before the request touches any node. A policy may DENY (reject early),
      // SHORT-CIRCUIT (serve a cached/canned response without proxying), or mutate
      // the body (e.g. redact PII). analytics/finops run as post-hooks + sinks.
      const ctx: PolicyContext = {
        caller,
        corrId,
        model: (body.model as string) || target.model,
        image,
        body,
        target,
        candidates: live,
        clientIp,
        // Stash raw inbound headers for policies (e.g. client-auth) that need them.
        meta: { _inboundHeaders: req.headers as Record<string, string> },
      };
      if (policies.length) {
        await runPre(policies, ctx);
        if (ctx.deny) {
          traffic.record({ ts: Date.now(), gateway: target.name, model: ctx.model, modelServed: target.model, kind, status: ctx.deny.status, ms: Date.now() - started, bytes: 0, tokens: 0, caller, corrId, params, msgs, input: promptText(body), output: `(denied by policy ${ctx.deny.policy}: ${ctx.deny.message})` });
          return void json(res, ctx.deny.status, { error: { message: ctx.deny.message, type: 'policy_denied', policy: ctx.deny.policy } });
        }
        if (ctx.shortCircuit) {
          const sc = ctx.shortCircuit;
          json(res, sc.status, sc.json);
          const out = JSON.stringify(sc.json).slice(0, 2000);
          traffic.record({ ts: Date.now(), gateway: target.name, model: ctx.model, modelServed: sc.from, kind, status: sc.status, ms: Date.now() - started, bytes: out.length, tokens: 0, caller, corrId, params, msgs, input: promptText(body), output: out });
          void runPost(policies, ctx, { status: sc.status, output: out, promptTokens: 0, completionTokens: 0, streamed: false, raw: sc.json });
          return;
        }
      }
      // Admission control: wait for a slot on the chosen node. If its wait-queue
      // is full, shed load gracefully (503 + Retry-After) instead of piling more
      // pressure onto a node that's already at capacity.
      try {
        await limiter.acquire(target.name);
      } catch (e) {
        if (e instanceof Saturated) {
          traffic.record({ ts: Date.now(), gateway: target.name, model: (body.model as string) || target.model, modelServed: target.model, kind, status: 503, ms: Date.now() - started, bytes: 0, tokens: 0, caller, corrId, params, msgs, input: promptText(body), output: '(shed: node saturated)' });
          res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '2' });
          return void res.end(JSON.stringify({ error: { message: `gateway ${target.name} saturated — retry shortly`, type: 'backpressure' } }));
        }
        throw e;
      }
      let released = false;
      const release = (): void => {
        if (!released) {
          released = true;
          limiter.release(target.name);
        }
      };
      res.on('close', release); // client aborted before completion

      const forwarded = normalizeMessages(raw, ctx.body);

      // Forward the request verbatim. Only host + content-length are rewritten
      // (routing necessity). X-Forwarded-For records the true client IP so the
      // upstream (or a cloud provider) can see where the call originated.
      // Auth headers (Authorization / x-api-key) are left completely untouched —
      // the client's token reaches the upstream exactly as sent.
      const up = http.request(
        {
          host: target.host,
          port: target.port,
          method: req.method,
          path: req.url,
          headers: {
            ...req.headers,
            host: `${target.host}:${target.port}`,
            'content-length': forwarded.length,
          },
        },
        (ur) => {
          res.writeHead(ur.statusCode || 502, { ...ur.headers, 'x-offgrid-gateway': target.name, 'x-offgrid-model': target.model });
          let bytes = 0;
          let firstByteAt = 0;
          let writeBlocked = 0;
          const buf: Buffer[] = [];
          ur.on('data', (c: Buffer) => {
            if (!firstByteAt) firstByteAt = Date.now();
            bytes += c.length;
            if (!res.write(c)) writeBlocked += 1; // downstream backpressure: client can't drain
            if (buf.length < 500) buf.push(c);
          });
          ur.on('end', () => {
            res.end();
            release();
            let tokens = 0;
            let promptTokens = 0;
            let completionTokens = 0;
            let output = '';
            let reasoning = '';
            let finish = '';
            let tps = 0;
            let toolCalls: { name: string; args: string }[] = [];
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
                if (Array.isArray(tc)) toolCalls = tc.map((c: { function?: { name?: string; arguments?: string } }) => ({ name: c?.function?.name || '', args: (c?.function?.arguments || '').slice(0, 400) }));
              }
            } catch {
              /* partial / non-json */
            }
            const elapsed = Date.now() - started;
            if (!tps && completionTokens && elapsed > 0) tps = Math.round((completionTokens / elapsed) * 1000);
            traffic.record({
              ts: Date.now(),
              gateway: target.name,
              model: (body.model as string) || target.model,
              modelServed: target.model,
              kind,
              status: ur.statusCode || 0,
              ms: elapsed,
              bytes,
              tokens,
              promptTokens,
              completionTokens,
              tps,
              ttfb: firstByteAt ? firstByteAt - started : undefined,
              writeBlocked,
              finish,
              toolCalls,
              reasoning: reasoning.slice(0, 2000),
              caller,
              corrId,
              params,
              msgs,
              input: promptText(body),
              output: output.slice(0, 2000),
              ...(rawHeaders && {
                requestHeaders: Object.fromEntries(
                  Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
                ),
                responseHeaders: Object.fromEntries(
                  Object.entries(ur.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
                ),
              }),
            });
            if (policies.length)
              void runPost(policies, ctx, { status: ur.statusCode || 0, output, promptTokens, completionTokens, streamed: streaming });
          });
        },
      );
      up.on('error', (e) => {
        release();
        traffic.record({
          ts: Date.now(),
          gateway: target.name,
          model: (body.model as string) || target.model,
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
          output: `(error: ${e.message})`,
        });
        json(res, 502, { error: { message: `gateway ${target.name} (${target.host}) error: ${e.message}`, type: 'upstream_error' } });
      });
      up.setTimeout(120000, () => up.destroy(new Error('upstream timeout')));
      up.end(forwarded);
    });
  };

  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    if (url === '/healthz') return void json(res, 200, { ok: true });
    void (async () => {
      if ((apiKey || kcCfg) && !(await checkAuth(req))) {
        return void json(res, 401, { error: { message: 'invalid or missing credentials', type: 'unauthorized' } });
      }
      handleRequest(req, res, url, wantsHtml);
    })();
  });

  const api: ClusterGateway = {
    server,
    pool,
    live,
    traffic,
    health,
    trafficJSON,
    poolInfo,
    listen() {
      server.listen(port, host, () => {
        // eslint-disable-next-line no-console
        console.log(`[cluster] routing on ${host}:${port} across`, pool.map((g) => `${g.name}:${g.model}${g.vision ? '+vision' : ''}${g.enabled === false ? ' (off)' : ''}`).join(', '));
        // eslint-disable-next-line no-console
        console.log(`[cluster] observability sinks:`, sinks.map((s) => s.name).join(', '));
      });
      health.start(live);
      return this;
    },
    close() {
      health.stop();
      server.close();
    },
  };
  return api;
}
