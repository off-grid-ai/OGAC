// Policy layer — the middle layer between routing and observability.
//
// Every request flows through a composable policy pipeline: each Policy may run
// a `pre` hook (inspect/mutate the request, deny it, redirect it, or serve a
// cached response) and a `post` hook (inspect/redact the response, populate the
// cache). Policies are plug-and-play exactly like observability sinks — built-ins
// ship for guardrails, rate limits, budgets, and caching; a host can add its own
// without touching the gateway core. This is the Portkey-class control surface,
// truly-local.
import type { GatewayNode } from '../cluster/types';

/** Mutable per-request context threaded through the policy pipeline. */
export interface PolicyContext {
  /** Caller identity (user-agent / x-offgrid-user header / virtual key). */
  caller: string;
  /** Correlation id for tracing. */
  corrId: string;
  /** Requested model (post-normalization). */
  model: string;
  /** Whether the request carries an image (vision). */
  image: boolean;
  /** The parsed, MUTABLE request body — pre hooks may rewrite it (e.g. redact PII). */
  body: Record<string, unknown>;
  /** The chosen upstream node (pre hooks may reassign to reroute). */
  target: GatewayNode;
  /** Fallback candidates in preference order (used on upstream failure). */
  candidates: GatewayNode[];
  /** Set by a pre hook to reject the request before it hits any node. */
  deny?: { status: number; message: string; policy: string };
  /** Set by a pre hook (e.g. cache) to serve a response WITHOUT proxying. */
  shortCircuit?: { status: number; json: unknown; from: string };
  /** Free-form annotations policies attach for the observability record. */
  meta: Record<string, unknown>;
  /**
   * The client's originating IP (respects X-Forwarded-For from a trusted proxy).
   * Forwarded to upstreams as X-Forwarded-For.
   */
  clientIp?: string;
  /**
   * A cloud-provider token supplied by the enterprise client via x-provider-key header
   * (Mode B: client brings their own upstream key). Detected by the clientAuth policy.
   * The gateway forwards the original request verbatim — this field is for observability.
   */
  clientToken?: { value: string; kind: 'bearer' | 'x-api-key' };
  /**
   * Keycloak client ID (azp claim) or subject (sub) — set by the keycloakAuth policy.
   * Identifies the machine client for observability, rate-limiting, and scope enforcement.
   */
  clientId?: string;
  /**
   * OAuth2 scopes from the Keycloak JWT — set by the keycloakAuth policy.
   * Includes model:*, mode:*, tier:* scopes used for routing and policy decisions.
   */
  clientScopes?: string[];
}

/** What a post hook sees about the completed call. */
export interface PolicyOutcome {
  status: number;
  output: string;
  promptTokens: number;
  completionTokens: number;
  streamed: boolean;
  /** The raw upstream JSON (non-streamed only), for caching. */
  raw?: unknown;
}

export interface Policy {
  readonly name: string;
  /** Runs before proxying. May mutate ctx.body/target, set ctx.deny or ctx.shortCircuit. */
  pre?(ctx: PolicyContext): void | Promise<void>;
  /** Runs after the response completes (or a short-circuit). May redact / cache / meter. */
  post?(ctx: PolicyContext, outcome: PolicyOutcome): void | Promise<void>;
}

/** Run all pre hooks in order; stops early once a policy denies or short-circuits. */
export async function runPre(policies: Policy[], ctx: PolicyContext): Promise<void> {
  for (const p of policies) {
    if (ctx.deny || ctx.shortCircuit) return;
    if (p.pre) {
      try {
        await p.pre(ctx);
      } catch {
        /* a broken policy must never take the gateway down — fail open */
      }
    }
  }
}

/** Run all post hooks (best-effort, never throws). */
export async function runPost(policies: Policy[], ctx: PolicyContext, outcome: PolicyOutcome): Promise<void> {
  for (const p of policies) {
    if (p.post) {
      try {
        await p.post(ctx, outcome);
      } catch {
        /* fail open */
      }
    }
  }
}
