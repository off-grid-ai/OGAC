// Pure, zero-I/O rules for the CALLER CONTEXT of an agent run — the identity/org/project (and the
// canonical run id) that must attribute a run's audit/trace/lineage/provenance fan-out identically
// whether it executes INLINE (in-process) or DURABLY (Temporal worker).
//
// The gap this closes (C4): a durable run executes in a background worker that has NO request, so it
// can't resolve the acting principal from a session the way the inline path does (audit-actor.ts →
// actorFrom). Without threading the context, a durable run fell back to a lossy actor (email string
// only, losing machine/service-account identity + display label) and — worse — a DIFFERENT run id
// than the workflow tracked, so its four planes correlated to nothing the caller could look up.
//
// This module is the single place that (a) decides the EFFECTIVE run id (honor a provided one, else
// mint), and (b) folds an optional resolved context onto the fields runAgent attributes with. It is
// pure over plain data (like tenancy-policy.ts / agent-run-durable.ts) so it is exhaustively
// unit-testable with real functions and no mocks; the impure session read lives in audit-actor.ts
// and the runId minting seam is injected.

import type { Actor } from '@/lib/audit-event';
import { actorFrom } from '@/lib/audit-event';
import type { PipelineContract } from '@/lib/pipeline-enforcement';

/**
 * The caller context for a governed agent run. Resolved AT SUBMIT TIME from the request (same source
 * as an inline run: the session actor + current org + current project) and carried through the
 * durable workflow so the worker attributes the run exactly as the request would have.
 *
 * Every field is optional so the INLINE path (which resolves actor from `caller` + org from the
 * orgId param, and has no project) can omit it entirely and keep its exact current behavior.
 */
export interface RunContext {
  /** Canonical run id. When present it is used verbatim as the ONE correlation key across all four
   *  planes (audit/trace/lineage/provenance) AND as the persisted run's id — so the durable run's
   *  fan-out is keyed by the same id the workflow/dispatch tracked. Absent → runAgent mints one. */
  runId?: string;
  /** Fully-resolved acting principal (machine vs user + display label preserved). Absent → derived
   *  from the `caller` email string, as today. */
  actor?: Actor;
  /** Owning org. Absent → the orgId param / DEFAULT_ORG, as today. */
  org?: string;
  /** Owning project, if any. Attributed onto the canonical audit event's `project`. */
  project?: string;
  /**
   * PA-16b — the resolved bound-pipeline contract this agent run enforces (data allowlist + egress
   * leash + policy/guardrail overlay). OPTIONAL + ADDITIVE: absent/null ⇒ legacy behaviour (no extra
   * gate) — a run with no bound pipeline behaves EXACTLY as before. The route/dispatch resolves it
   * once (resolveAgentBinding) and threads it here; runAgent calls the PURE enforcement decisions
   * (enforceDataAccess before retrieval, enforceModelCall before the gateway call) + audits denials.
   * Plain JSON-serializable data (mirrors AppRunContext.contract), so it can also ride the durable
   * workflow input in a later round.
   */
  contract?: PipelineContract | null;
}

/**
 * The attribution a run emits with: actor + org + project. Derived once and reused by every plane so
 * inline and durable produce an identical event. `caller` (the invoking email, used for the gateway
 * x-offgrid-user header + legacy run-audit doc) is preserved verbatim from the request either way.
 */
export interface RunAttribution {
  actor: Actor;
  org: string;
  project?: string;
}

/**
 * Resolve the attribution for a run. When a resolved context is supplied (durable path), its actor /
 * org / project win — they were resolved from the request at submit time exactly as the inline path
 * resolves them. Otherwise fall back to the inline derivation: actor from the caller email (machine
 * fallback for a system/scheduled run with no caller), org from the orgId param.
 *
 * `machineFallback` is the actor used when there is neither a resolved actor nor a caller — a
 * system/scheduled run. Passed in (not hard-coded) so the caller owns the "system" identity.
 */
export function resolveRunAttribution(args: {
  context?: RunContext;
  caller?: string;
  orgId: string;
  machineFallback: Actor;
}): RunAttribution {
  const { context, caller, orgId, machineFallback } = args;
  const actor = context?.actor ?? (caller ? actorFrom({ email: caller }) : machineFallback);
  const org = context?.org?.trim() || orgId;
  const project = context?.project?.trim() || undefined;
  return { actor, org, project };
}

/**
 * The effective run id: honor a caller-provided id (the durable path threads the id the workflow
 * tracks so the persisted run + fan-out share it), else mint a fresh one via the injected minter.
 * The minter is injected (not imported) to keep this module pure/testable.
 */
export function effectiveRunId(contextRunId: string | undefined, mint: () => string): string {
  const provided = contextRunId?.trim();
  return provided || mint();
}
