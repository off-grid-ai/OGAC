// ─── AMBIENT RUN ATTRIBUTION — who this inference belongs to, without threading it everywhere ─────
//
// Closes G-GATEWAY-ATTR-SWEEP.
//
// The aggregator stamps `org` (and the caller) on every observability doc from the `x-offgrid-org` /
// `x-offgrid-user` headers, and the org-scoped FinOps/Insights surfaces read that index. Two call
// sites sent those headers; TEN did not — grounding, scoring, eval-runner (×2), ingest, chat-memory,
// app-compile, pipeline-execute-wiring, rag, org-knowledge and the inference adapter — so a real
// governed run shipped docs with `org: null` and governed traffic read as unattributed.
//
// The obvious fix (add `orgId` to ten signatures, several of them port interfaces with multiple
// implementations) is a wide, risky change to public seams. It was rejected once for exactly that
// reason, and the rejection was right.
//
// The seam that already exists is better: EVERY one of those sites builds its headers with
// `gatewayHeaders()`. So attribution belongs THERE, read from an ambient run scope, and all ten are
// fixed with zero signature changes. AsyncLocalStorage carries the scope across awaits within one
// logical run, which is exactly the lifetime attribution should follow.
//
// Deliberate properties:
//   • Absent scope ⇒ no headers, byte-identical to today. Nothing breaks if a path never opts in.
//   • An EXPLICIT per-call attribution still wins, so the two sites that already pass it keep working
//     and any future caller can override.
//   • Nothing here throws: attribution must never be able to fail an inference.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface GatewayScope {
  orgId?: string;
  userId?: string;
}

// One store per process. Module-level so every importer shares the same context.
const storage = new AsyncLocalStorage<GatewayScope>();

/**
 * Run `fn` with the given attribution in scope. Every gateway call made underneath it — however deep,
 * across any number of awaits — is stamped, without any of them knowing about it.
 */
export function withGatewayScope<T>(scope: GatewayScope, fn: () => T): T {
  // A scope with nothing in it would only add overhead and could shadow an outer, useful one.
  if (!scope.orgId && !scope.userId) return fn();
  const parent = storage.getStore();
  // Merge, so an inner scope that only knows the user keeps the outer org rather than erasing it.
  return storage.run({ ...parent, ...scope }, fn);
}

/** The attribution currently in scope, if any. */
export function currentGatewayScope(): GatewayScope | undefined {
  return storage.getStore();
}
