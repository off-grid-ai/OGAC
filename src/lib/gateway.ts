// Single source of truth for reaching the Off Grid AI Gateway (the OpenAI-compatible
// cluster aggregator). The aggregator authenticates /v1/* with a static API key
// (OFFGRID_GATEWAY_API_KEY) sent as `x-api-key`. Every server-side call to the gateway
// must go through gatewayHeaders() so the key is attached — without it the aggregator
// returns 401 and the console shows "no models" / empty responses.
export const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

const GATEWAY_API_KEY = process.env.OFFGRID_GATEWAY_API_KEY ?? '';

/** Headers for a gateway call — attaches the API key when configured, plus any extras. */
export function gatewayHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(GATEWAY_API_KEY ? { 'x-api-key': GATEWAY_API_KEY } : {}),
    ...extra,
  };
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
