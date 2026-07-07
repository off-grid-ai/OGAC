// PURE builders for the audit events a cloud-routing outcome must emit — so "egress is logged" and
// "cost is attributed" are guaranteed by a tested rule, not by remembering to hand-write an event at
// each call site. Zero I/O: these return `AuditEventInput`s that the caller feeds to `recordAudit`.
//
// Two events matter for governance evidence:
//   • gateway.egress  — a request LEFT the box to a named cloud provider (outcome ok/error), with the
//                       real model + token usage so cost auto-derives (costUsdFor in buildAuditEvent).
//   • gateway.egress.blocked — a cloud route was NOT taken (blocked, or cloud unavailable → fell back),
//                       recorded so the leash / honest-degradation is provable after the fact.

import type { AuditEventInput } from './audit-event';
import type { Actor } from './audit-event';
import type { CloudPlan } from './cloud-routing';

export interface EgressAuditContext {
  actor: Actor;
  org: string;
  project?: string | null;
  runId?: string | null;
}

/** Tokens observed on a completed cloud call. */
export interface CloudUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * The audit event for a request that actually egressed to cloud. `model` is the provider-namespaced
 * id (e.g. `openai:gpt-4o-mini`) so FinOps prices it as cloud and the provider is visible. Cost is
 * left undefined → derived from model + total tokens by buildAuditEvent. PURE.
 */
export function egressAuditEvent(
  ctx: EgressAuditContext,
  plan: CloudPlan,
  usage: CloudUsage,
  outcome: 'ok' | 'error',
): AuditEventInput {
  const providerId = plan.selection?.provider.id ?? 'cloud';
  const model = plan.selection ? `${providerId}:${plan.selection.model}` : 'cloud';
  return {
    actor: ctx.actor,
    org: ctx.org,
    project: ctx.project ?? null,
    action: 'gateway.egress',
    resource: `provider:${providerId}`,
    model,
    tokens: {
      prompt: Math.max(0, usage.promptTokens),
      completion: Math.max(0, usage.completionTokens),
      total: Math.max(0, usage.promptTokens) + Math.max(0, usage.completionTokens),
    },
    outcome,
    runId: ctx.runId ?? null,
  };
}

/**
 * The audit event for a cloud route that did NOT leave the box — either blocked (leash / policy) or
 * cloud-unavailable and fell back. Outcome is `blocked` so it shows in the "what was blocked/leashed"
 * evidence. PURE.
 */
export function egressBlockedAuditEvent(ctx: EgressAuditContext, plan: CloudPlan): AuditEventInput {
  return {
    actor: ctx.actor,
    org: ctx.org,
    project: ctx.project ?? null,
    action: 'gateway.egress.blocked',
    resource: plan.cloudUnavailable ? 'provider:unavailable' : 'provider:leashed',
    outcome: 'blocked',
    runId: ctx.runId ?? null,
  };
}
