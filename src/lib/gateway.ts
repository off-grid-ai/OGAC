// Single source of truth for reaching the Off Grid AI Gateway (the OpenAI-compatible
// cluster aggregator). The aggregator authenticates /v1/* with EITHER a Keycloak service
// JWT (Bearer) OR a static API key (OFFGRID_GATEWAY_API_KEY) sent as `x-api-key`.
//
// Phase 4.10-B: auth now flows through the service-token broker (`getServiceCredential('gateway')`).
// When the broker has a Keycloak client secret provisioned it returns a Bearer JWT (preferred); until
// then it returns `kind:'none'` and we fall back to the legacy static `x-api-key` — BYTE-IDENTICAL to
// the pre-broker behavior, so nothing breaks pre-deploy. The auth-selection rule is the pure,
// unit-tested `chooseGatewayAuth`.
import { getServiceCredential, invalidateServiceCredential } from './service-credentials';
import { chooseGatewayAuth, NO_CREDENTIAL } from './service-credentials-lib';

export const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

const GATEWAY_API_KEY = process.env.OFFGRID_GATEWAY_API_KEY ?? '';

/**
 * Synchronous gateway headers (LEGACY seam). Emits exactly what the console sent before the broker:
 * the static `x-api-key` when configured, else no auth. Kept for the many synchronous call sites that
 * can't await; `gatewayHeadersAsync` is the broker-preferring path for calls that can.
 */
export function gatewayHeaders(extra: Record<string, string> = {}): Record<string, string> {
  // NO_CREDENTIAL → chooseGatewayAuth falls straight through to the legacy x-api-key branch.
  return { ...chooseGatewayAuth(NO_CREDENTIAL, GATEWAY_API_KEY || undefined), ...extra };
}

/**
 * Broker-preferring gateway headers. Prefers a Keycloak Bearer from the broker; falls back to the
 * legacy static `x-api-key`; else no auth. When the broker is unprovisioned this is byte-identical to
 * `gatewayHeaders()`.
 */
export async function gatewayHeadersAsync(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const cred = await getServiceCredential('gateway');
  return { ...chooseGatewayAuth(cred, GATEWAY_API_KEY || undefined), ...extra };
}

/**
 * Fetch the gateway with broker auth + a single transparent 401 refresh-and-retry (spec B3): on a 401
 * from a brokered Bearer, invalidate the cached token, re-mint, and retry once. If we're on the legacy
 * static key (no brokered bearer), a 401 is a real config error — surfaced, not retried.
 */
export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const extra = (init.headers as Record<string, string>) ?? {};
  const headers = await gatewayHeadersAsync(extra);
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers });
  if (res.status === 401 && headers.authorization) {
    invalidateServiceCredential('gateway');
    const retryHeaders = await gatewayHeadersAsync(extra);
    return fetch(`${GATEWAY_URL}${path}`, { ...init, headers: retryHeaders });
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node-management: pure request/response shaping + action validation.
//
// These are ZERO-import, unit-testable rules (no fetch, no I/O). The route
// handlers do the network; these decide the shape of what's sent and whether an
// action is even legal for a node's current state / the control plane's
// capabilities.
//
// HONESTY CONTRACT — read this before adding an action:
//   The aggregator (`scripts/gateway-aggregator.mjs`) is a ROUTER. It exposes
//   GET /nodes (read-only inventory) and per-node /v1/models, but it does NOT
//   currently expose any node CONTROL endpoint (no POST /nodes/[name], no model
//   swap, no restart, no enable/disable). Those require on-host execution the
//   aggregator does not front today.
//
//   So every write action here is classified by `nodeActionSupport`:
//     - 'model-swap'   → needs the node's own model-load API behind the
//                        aggregator's POST /nodes/[name]. NOT exposed yet ⇒ blocked.
//     - 'restart'      → needs host/process control (launchd/pkill). NOT exposed
//                        ⇒ blocked.
//     - 'enable'/'disable' → needs the aggregator to persist the pool `enabled`
//                        flag. NOT exposed ⇒ blocked.
//   The UI renders blocked actions DISABLED with the returned reason as a
//   tooltip. It must never POST-and-pretend. The route double-checks: if the
//   aggregator answers a control POST with 404/501, the route surfaces
//   `notActionable` rather than a fake success.
// ─────────────────────────────────────────────────────────────────────────────

/** Raw node record as returned by the aggregator's GET /nodes. */
export interface AggregatorNode {
  name: string;
  host: string;
  port?: number;
  model: string;
  vision?: boolean;
  health?: string;
  enabled?: boolean;
  installedModels?: Array<{ id: string; meta?: unknown }>;
}

/** Shape the UI's node cards consume. */
export interface NodeView {
  name: string;
  host: string;
  port: number;
  model: string;
  vision: boolean;
  health: 'up' | 'degraded' | 'down' | 'unknown';
  reachable: boolean;
  enabled: boolean;
  /** The model the node is currently serving (its loaded model). */
  activeModel: string;
  /** Model ids installed on the node, selectable in the swap dropdown. */
  installed: string[];
}

const HEALTHS = new Set(['up', 'degraded', 'down', 'unknown']);

/** Normalise one raw aggregator node into the UI view shape (pure). */
export function mapAggregatorNode(n: AggregatorNode): NodeView {
  const health = (HEALTHS.has(String(n.health)) ? n.health : 'unknown') as NodeView['health'];
  const installed = Array.isArray(n.installedModels)
    ? n.installedModels.map((m) => m?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  return {
    name: n.name,
    host: n.host,
    port: typeof n.port === 'number' ? n.port : 7878,
    model: n.model,
    vision: Boolean(n.vision),
    health,
    // The aggregator only lists a node under /nodes when it probed it; a node
    // that is down is still listed. Reachable = anything not 'down'/'unknown'.
    reachable: health === 'up' || health === 'degraded',
    // Aggregator has no pool-toggle API, so `enabled` is only present if some
    // future control plane sets it; default true (it's routing to the node).
    enabled: n.enabled !== false,
    activeModel: n.model,
    installed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gateway TUNING — read-only shaping of the aggregator's GET /config snapshot.
//
// HONESTY CONTRACT: the aggregator (`scripts/gateway-aggregator.mjs`) exposes its
// runtime tuning knobs at GET /config, but they are all set from process env in the
// launchd plist on S1 and need an aggregator RESTART to change — there is NO live
// reconfigure endpoint. So this surface is READ-ONLY on purpose. It also reports the
// honest capability flags: the router has no response cache and no per-request
// fallback chain, and rate-limiting is the Caddy edge's / console middleware's job
// (by design, not a gap). These pure functions do the shaping; the route does I/O.
// ─────────────────────────────────────────────────────────────────────────────

/** Raw runtime config as returned by the aggregator's GET /config. All fields optional
 *  so a partial / older aggregator response degrades gracefully. */
export interface AggregatorConfig {
  readonly?: boolean;
  routing?: {
    poolSource?: string;
    poolRefreshMs?: number;
    poolPinned?: boolean;
    liveNodes?: number;
    poolNodes?: number;
    imageLiveNodes?: number;
    fallbackPoolNodes?: number;
  };
  health?: {
    probeEnabled?: boolean;
    windowMs?: number;
    slowMs?: number;
    jamMs?: number;
    degradedErrRate?: number;
    downErrRate?: number;
    probeEveryMs?: number;
    probeTimeoutMs?: number;
  };
  timeouts?: { chatUpstreamMs?: number; imageUpstreamMs?: number };
  capabilities?: {
    responseCache?: boolean;
    perRequestFallbackChain?: boolean;
    rateLimit?: boolean;
    liveReconfigure?: boolean;
  };
}

/** One displayed tuning row: a human label, the current value, and how to change it. */
export interface TuningRow {
  key: string;
  label: string;
  value: string;
  /** What it takes to change this value (honesty about editability). */
  changeVia: string;
  description: string;
}

export interface TuningGroup {
  group: string;
  rows: TuningRow[];
}

/** A capability the router genuinely does NOT have, surfaced so the UI never fakes a control. */
export interface TuningCapability {
  key: string;
  label: string;
  present: boolean;
  note: string;
}

export interface GatewayTuningView {
  /** Always true — these knobs are env-set on S1; the console can read but not write them. */
  readonly: boolean;
  groups: TuningGroup[];
  capabilities: TuningCapability[];
}

function tuneMs(v: number | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (v >= 1000 && v % 1000 === 0) return `${v / 1000}s`;
  return `${v}ms`;
}
function tunePct(v: number | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—';
}
function tuneNum(v: number | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';
}
function tuneBool(v: boolean | undefined): string {
  return v === true ? 'on' : v === false ? 'off' : '—';
}

const CHANGE_RESTART = 'aggregator env (launchd plist on S1) — restart to change';
const CHANGE_SSOT = 'the Fleet configuration editor (Control tab) — writes the DB SSOT';

/**
 * Shape the aggregator's raw /config into grouped, labelled, honest read-only rows +
 * capability flags. Pure — no I/O. Tolerates a partial/absent response.
 */
export function shapeGatewayTuning(cfg: AggregatorConfig | null): GatewayTuningView {
  const r = cfg?.routing ?? {};
  const h = cfg?.health ?? {};
  const t = cfg?.timeouts ?? {};
  const cap = cfg?.capabilities ?? {};

  const groups: TuningGroup[] = [
    {
      group: 'Routing',
      rows: [
        { key: 'liveNodes', label: 'Live nodes', value: `${tuneNum(r.liveNodes)} of ${tuneNum(r.poolNodes)}`, changeVia: CHANGE_SSOT, description: 'Enabled nodes currently in the routing pool.' },
        { key: 'imageLiveNodes', label: 'Image nodes', value: tuneNum(r.imageLiveNodes), changeVia: CHANGE_SSOT, description: 'Enabled image-generation gateways.' },
        { key: 'poolRefreshMs', label: 'Pool refresh interval', value: tuneMs(r.poolRefreshMs), changeVia: CHANGE_RESTART, description: 'How often the router re-pulls the fleet SSOT pool.' },
        { key: 'poolPinned', label: 'Pool pinned (OFFGRID_POOL)', value: tuneBool(r.poolPinned), changeVia: CHANGE_RESTART, description: 'When on, an env-pinned pool overrides the SSOT (dev/manual).' },
        { key: 'fallbackPoolNodes', label: 'Hardcoded fallback pool', value: `${tuneNum(r.fallbackPoolNodes)} nodes`, changeVia: CHANGE_RESTART, description: 'Last-known-good pool the router serves from if the SSOT is unreachable — routing never drops.' },
      ],
    },
    {
      group: 'Health detection',
      rows: [
        { key: 'probeEnabled', label: 'Synthetic probe', value: tuneBool(h.probeEnabled), changeVia: CHANGE_RESTART, description: '1-token generation probe that catches jams with no live traffic.' },
        { key: 'windowMs', label: 'Recent window', value: tuneMs(h.windowMs), changeVia: CHANGE_RESTART, description: 'How far back error-rate/latency signals are measured.' },
        { key: 'slowMs', label: 'Degraded latency', value: tuneMs(h.slowMs), changeVia: CHANGE_RESTART, description: 'Avg latency above this marks a node degraded.' },
        { key: 'jamMs', label: 'Jammed latency', value: tuneMs(h.jamMs), changeVia: CHANGE_RESTART, description: 'Avg latency above this marks a node down (jammed).' },
        { key: 'degradedErrRate', label: 'Degraded error rate', value: tunePct(h.degradedErrRate), changeVia: CHANGE_RESTART, description: 'Recent error rate above this marks a node degraded.' },
        { key: 'downErrRate', label: 'Down error rate', value: tunePct(h.downErrRate), changeVia: CHANGE_RESTART, description: 'Recent error rate above this marks a node down.' },
        { key: 'probeEveryMs', label: 'Probe interval', value: tuneMs(h.probeEveryMs), changeVia: CHANGE_RESTART, description: 'How often each node is probed.' },
        { key: 'probeTimeoutMs', label: 'Probe timeout', value: tuneMs(h.probeTimeoutMs), changeVia: CHANGE_RESTART, description: 'Bound on the synthetic probe generation.' },
      ],
    },
    {
      group: 'Upstream timeouts',
      rows: [
        { key: 'chatUpstreamMs', label: 'Chat / vision timeout', value: tuneMs(t.chatUpstreamMs), changeVia: CHANGE_RESTART, description: 'Per-request timeout proxying to a chat/vision node.' },
        { key: 'imageUpstreamMs', label: 'Image timeout', value: tuneMs(t.imageUpstreamMs), changeVia: CHANGE_RESTART, description: 'Per-request timeout proxying to an image node.' },
      ],
    },
  ];

  const capabilities: TuningCapability[] = [
    { key: 'responseCache', label: 'Response cache', present: cap.responseCache === true, note: 'The router does not cache responses. There is no cache TTL to tune.' },
    { key: 'perRequestFallbackChain', label: 'Per-request fallback chain', present: cap.perRequestFallbackChain === true, note: 'No model→model fallback. Resilience comes from the multi-node pool + the hardcoded fallback pool, both above.' },
    { key: 'rateLimit', label: 'Rate limiting / WAF', present: cap.rateLimit === true, note: 'Enforced at the Caddy edge (gateway.getoffgridai.co) plus a 60 req/min per-IP layer in the console middleware — by design, not here.' },
    { key: 'liveReconfigure', label: 'Live reconfigure', present: cap.liveReconfigure === true, note: 'Tuning knobs are env-set in the aggregator launchd plist on S1; restart the aggregator to apply changes.' },
  ];

  return { readonly: cfg?.readonly !== false, groups, capabilities };
}

export type NodeAction = 'model' | 'restart' | 'enable' | 'disable';

/** Which host capability an action needs — drives the honesty gate. */
export function nodeActionSupport(action: NodeAction): {
  needs: string;
  /** True only when a real aggregator control endpoint backs this action. */
  backed: boolean;
} {
  switch (action) {
    case 'model':
      return { needs: "the aggregator to front the node's model-load API (POST /nodes/[name])", backed: false };
    case 'restart':
      return { needs: 'host/process control on the node (launchd / pkill), not exposed by the aggregator', backed: false };
    case 'enable':
    case 'disable':
      return { needs: 'the aggregator to persist the pool `enabled` flag', backed: false };
  }
}

export interface NodeActionRequest {
  action: NodeAction;
  /** For 'model': the model id to load/swap to. */
  model?: string;
}

export type ActionValidation =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: string; blocked?: boolean };

/**
 * Validate a requested node action against the node's state, and shape the body
 * to POST to the aggregator. Pure — no I/O.
 *
 * Returns `{ ok:false, blocked:true }` when the action has no real backend
 * (honesty gate): the caller must surface this as "not remotely actionable
 * yet", never as success.
 */
export function validateNodeAction(node: NodeView, req: NodeActionRequest): ActionValidation {
  const support = nodeActionSupport(req.action);

  switch (req.action) {
    case 'model': {
      const model = (req.model ?? '').trim();
      if (!model) return { ok: false, reason: 'a target model id is required' };
      if (node.installed.length && !node.installed.includes(model)) {
        return { ok: false, reason: `model "${model}" is not installed on ${node.name}` };
      }
      if (model === node.activeModel) {
        return { ok: false, reason: `${node.name} already serves "${model}"` };
      }
      if (!support.backed) return { ok: false, blocked: true, reason: `Model swap needs ${support.needs}.` };
      return { ok: true, body: { action: 'activate', id: model, kind: 'text' } };
    }
    case 'restart': {
      if (!support.backed) return { ok: false, blocked: true, reason: `Restart needs ${support.needs}.` };
      return { ok: true, body: { action: 'restart' } };
    }
    case 'enable':
    case 'disable': {
      const wantEnabled = req.action === 'enable';
      if (node.enabled === wantEnabled) {
        return { ok: false, reason: `${node.name} is already ${wantEnabled ? 'enabled' : 'disabled'}` };
      }
      if (!support.backed) return { ok: false, blocked: true, reason: `Enable/disable needs ${support.needs}.` };
      return { ok: true, body: { action: wantEnabled ? 'enable' : 'disable' } };
    }
  }
}
