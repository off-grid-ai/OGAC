// @offgrid/policy — structural gateway types.
// These MIRROR the shapes in @offgrid/gateway exactly, but are re-declared locally
// so this package stays standalone-buildable (no dependency on @offgrid/gateway).
// Keep in sync if the gateway contract changes.

/** A single addressable model node behind the gateway. */
export interface GatewayNode {
  name: string;
  host: string;
  port: number;
  model: string;
  vision?: boolean;
  enabled?: boolean;
}

/**
 * Mutable context threaded through every policy for a single request.
 * A policy's `pre` hook may set `deny` (reject) or `shortCircuit` (serve without
 * hitting a node), mutate `body`, or stash data in `meta`.
 */
export interface PolicyContext {
  caller: string;
  corrId: string;
  model: string;
  image: boolean;
  body: Record<string, unknown>;
  target: GatewayNode;
  candidates: GatewayNode[];
  deny?: { status: number; message: string; policy: string };
  shortCircuit?: { status: number; json: unknown; from: string };
  meta: Record<string, unknown>;
}

/** Result of an upstream call, handed to each policy's `post` hook. */
export interface PolicyOutcome {
  status: number;
  output: string;
  promptTokens: number;
  completionTokens: number;
  streamed: boolean;
  raw?: unknown;
}

/** A composable gateway policy. `pre` runs before dispatch, `post` after. */
export interface Policy {
  readonly name: string;
  pre?(ctx: PolicyContext): void | Promise<void>;
  post?(ctx: PolicyContext, o: PolicyOutcome): void | Promise<void>;
}
