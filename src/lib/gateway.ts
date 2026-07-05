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
