// PURE gateway RULES — ZERO imports, ZERO I/O, exhaustively unit-testable (mirrors
// tenancy-policy.ts / routing-policy.ts / cloud-providers.ts). Answers, with no network:
//
//   1. kind → egressClass. A gateway's egress class is DERIVED from its kind: an on-prem
//      cluster keeps data on the fleet ('on-prem'); every cloud provider means data leaves
//      ('cloud'). This is the single rule the routing leash keys off — defined here, once.
//   2. Given a registry row + the live health signals (aggregator health for on-prem, the
//      cloud-providers probe for cloud), MERGE them into an honest view: `available` = the
//      gateway is enabled AND configured AND reachable. Never faked — an unconfigured or
//      unreachable gateway reports as such (Services honest-health pattern).
//
// The DB I/O + probe fan-out live in gateways.ts (the adapter). This file can never, by
// construction, touch the network or the DB.

/** The four kinds of model-serving endpoint a pipeline can run on. */
export type GatewayKind = 'on-prem' | 'openai' | 'anthropic' | 'compat';

/** Where a gateway sends data: on-prem = stays on the fleet; cloud = leaves the network. */
export type EgressClass = 'on-prem' | 'cloud';

export const GATEWAY_KINDS: readonly GatewayKind[] = ['on-prem', 'openai', 'anthropic', 'compat'];

/** True iff the string is one of the four known gateway kinds. */
export function isGatewayKind(v: unknown): v is GatewayKind {
  return typeof v === 'string' && (GATEWAY_KINDS as readonly string[]).includes(v);
}

/**
 * Derive the egress class from a gateway kind — the ONE rule the routing leash keys off.
 * on-prem ⇒ 'on-prem' (data stays); every cloud kind (openai/anthropic/compat) ⇒ 'cloud'.
 * PURE. An unknown kind is treated conservatively as 'cloud' (assume data can leave) so a
 * mis-tagged gateway never silently claims "data stays."
 */
export function egressClassFor(kind: string): EgressClass {
  return kind === 'on-prem' ? 'on-prem' : 'cloud';
}

/** A registry row, as the pure layer sees it (no DB types leaked in). */
export interface GatewayRow {
  id: string;
  orgId: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string;
  egressClass: string;
  enabled: boolean;
  /** PA-15: the per-tenant provisioned gateway host, or null when this gateway uses the shared one. */
  hostname?: string | null;
  createdAt?: string | Date | null;
}

/**
 * The live health signal for ONE gateway, gathered by the adapter from the existing sources:
 *  - on-prem: the aggregator's fleet health (any node up ⇒ configured+reachable).
 *  - cloud:   the /api/v1/gateway/providers logic (configured = base URL+key in env; reachable =
 *             the provider endpoint answered the probe).
 * `configured` and `reachable` are the two truths; `available` is derived from them + `enabled`.
 */
export interface GatewayHealthSignal {
  /** The gateway has everything it needs to serve (nodes exist / provider key+URL present). */
  configured: boolean;
  /** The endpoint actually answered a liveness probe. */
  reachable: boolean;
  /** Optional coarse status for display; derived if omitted. */
  status?: 'up' | 'degraded' | 'down' | 'unconfigured';
  /** Optional human note (e.g. "3 of 4 nodes up", "not configured"). */
  detail?: string;
}

/** The merged, UI-ready view of a gateway: registry identity + honest live health. */
export interface GatewayView {
  id: string;
  orgId: string;
  name: string;
  kind: GatewayKind | string;
  baseUrl: string;
  defaultModel: string;
  egressClass: EgressClass;
  enabled: boolean;
  /** PA-15: the per-tenant provisioned gateway host ("<slug5><rand5>-gateway.<apex>"), or null. */
  hostname: string | null;
  configured: boolean;
  reachable: boolean;
  /** enabled AND configured AND reachable — the only state in which a pipeline may truly use it. */
  available: boolean;
  status: 'up' | 'degraded' | 'down' | 'unconfigured' | 'disabled';
  detail: string;
  createdAt: string | null;
}

/** Derive the coarse status shown on a card, honestly, from the merged facts. PURE. */
export function deriveStatus(
  enabled: boolean,
  signal: GatewayHealthSignal,
): GatewayView['status'] {
  if (!enabled) return 'disabled';
  if (!signal.configured) return 'unconfigured';
  if (signal.status === 'degraded') return 'degraded';
  return signal.reachable ? 'up' : 'down';
}

/**
 * MERGE a registry row with its live health signal into the honest UI view. PURE — the adapter
 * has already done the I/O and hands us the facts. `available` is the strict AND of enabled +
 * configured + reachable: a disabled, unconfigured, or unreachable gateway is NEVER "available."
 * `egressClass` is re-derived from kind here so the view is always consistent with the identity,
 * even if a stored row drifted.
 */
export function mergeGatewayHealth(row: GatewayRow, signal: GatewayHealthSignal): GatewayView {
  const available = row.enabled && signal.configured && signal.reachable;
  const detail =
    signal.detail ??
    (!row.enabled
      ? 'disabled'
      : !signal.configured
        ? 'not configured'
        : signal.reachable
          ? 'reachable'
          : 'not answering');
  const createdAt =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : typeof row.createdAt === 'string'
        ? row.createdAt
        : null;
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    egressClass: egressClassFor(row.kind),
    enabled: row.enabled,
    hostname: row.hostname ?? null,
    configured: signal.configured,
    reachable: signal.reachable,
    available,
    status: deriveStatus(row.enabled, signal),
    detail,
    createdAt,
  };
}

/** Fields accepted when creating a gateway (id + egressClass + createdAt are derived server-side). */
export interface GatewayCreateInput {
  name?: unknown;
  kind?: unknown;
  baseUrl?: unknown;
  defaultModel?: unknown;
  enabled?: unknown;
}

export type GatewayValidation =
  | { ok: true; value: { name: string; kind: GatewayKind; baseUrl: string; defaultModel: string; egressClass: EgressClass; enabled: boolean } }
  | { ok: false; error: string };

/**
 * Validate + normalise a create request into a clean, egress-derived value. PURE — no id/DB here.
 * A name and a valid kind are required. Cloud kinds may omit a base URL (well-known defaults live in
 * cloud-providers.ts); a `compat` gateway REQUIRES a base URL (a generic proxy has no default).
 */
export function validateGatewayCreate(input: GatewayCreateInput): GatewayValidation {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  if (!isGatewayKind(input.kind)) {
    return { ok: false, error: `kind must be one of ${GATEWAY_KINDS.join(', ')}` };
  }
  const kind = input.kind;
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : '';
  if (kind === 'compat' && !baseUrl) {
    return { ok: false, error: 'an OpenAI-compatible (compat) gateway requires a base URL' };
  }
  const defaultModel = typeof input.defaultModel === 'string' ? input.defaultModel.trim() : '';
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  return {
    ok: true,
    value: { name, kind, baseUrl, defaultModel, egressClass: egressClassFor(kind), enabled },
  };
}

/** The clean, egress-derived patch an update yields — the same shape as a validated create value. */
export type GatewayUpdateValidation = GatewayValidation;

/**
 * Validate + normalise an UPDATE request into a clean, egress-derived value. PURE — no id/DB here.
 * Semantically identical to create validation: a name and a valid kind are required, a `compat`
 * gateway requires a base URL, and — critically — `egressClass` is ALWAYS RE-DERIVED from the (new)
 * kind, NEVER trusted from the client. Changing a gateway from an on-prem cluster to a cloud kind
 * therefore flips egress to 'cloud' automatically, keeping the routing leash honest. Delegates to
 * `validateGatewayCreate` so the create and update rules can never drift apart.
 */
export function validateGatewayUpdate(input: GatewayCreateInput): GatewayUpdateValidation {
  return validateGatewayCreate(input);
}
