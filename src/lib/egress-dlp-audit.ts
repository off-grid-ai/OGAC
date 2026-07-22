// PURE builders for the audit events an egress-DLP decision must emit — so "PII was stripped before
// it left the box" and "an unprotected/blocked cloud egress happened" are provable from a tested rule,
// not a hand-written event per call site (mirrors cloud-egress-audit.ts). Zero I/O: returns an
// `AuditEventInput` the caller feeds to `recordAudit`. NEVER carries the raw content — only WHAT was
// masked (entity types) and the governed reason, so the ledger is safe to read.

import type { Actor, AuditEventInput } from './audit-event';
import type { EgressDlpDecision } from './egress-dlp';

/** The canonical audit action for an egress-DLP decision at the cloud seam. */
export const EGRESS_DLP_ACTION = 'gateway.egress.dlp';
/** The canonical audit action for an admin changing the org egress-DLP policy. */
export const EGRESS_DLP_POLICY_ACTION = 'gateway.egress.dlp.policy';

export interface EgressDlpAuditContext {
  actor: Actor;
  org: string;
  project?: string | null;
  runId?: string | null;
  /** The provider-namespaced model the request egressed as (e.g. `openai:gpt-4o-mini`). */
  model?: string | null;
}

/**
 * Map an egress-DLP decision onto its audit outcome. PURE.
 *   • blocked            → 'blocked' (fail-closed or strictness refusal — nothing left).
 *   • masked             → 'redacted' (PII stripped before egress).
 *   • passthrough screened / unprotected / on-prem → 'ok'.
 */
export function egressDlpOutcome(decision: EgressDlpDecision): 'ok' | 'blocked' | 'redacted' {
  if (decision.action === 'blocked') return 'blocked';
  if (decision.action === 'masked') return 'redacted';
  return 'ok';
}

/**
 * The audit event for an egress-DLP decision at the cloud seam. `resource` records the action + the
 * masked entity types (never the content). Emitted for any decision that MATTERS to governance —
 * masked, blocked, or an unprotected (DLP-off) cloud egress — so the leash is provable. PURE.
 */
export function egressDlpAuditEvent(
  ctx: EgressDlpAuditContext,
  decision: EgressDlpDecision,
): AuditEventInput {
  const entities = decision.masked.length ? decision.masked.join('+') : 'none';
  const resource = decision.unprotected
    ? 'egress-dlp:unprotected'
    : `egress-dlp:${decision.action}:${entities}`;
  return {
    actor: ctx.actor,
    org: ctx.org,
    project: ctx.project ?? null,
    action: EGRESS_DLP_ACTION,
    resource,
    model: ctx.model ?? null,
    outcome: egressDlpOutcome(decision),
    runId: ctx.runId ?? null,
  };
}

/**
 * Should a decision be audited? PURE. On-prem passthrough and clean screened cloud passthrough are
 * the uninteresting norm; we audit MASKED (PII left the definition of the box), BLOCKED (a refusal),
 * and UNPROTECTED (DLP off on a cloud route) — the governance-relevant outcomes.
 */
export function egressDlpAuditable(decision: EgressDlpDecision): boolean {
  if (decision.action === 'masked' || decision.action === 'blocked') return true;
  return decision.unprotected === true;
}

/** The audit event for an admin changing the org egress-DLP policy (enabled / strictness). PURE. */
export function egressDlpPolicyAuditEvent(
  ctx: EgressDlpAuditContext,
  before: { enabled: boolean; strictness: string },
  after: { enabled: boolean; strictness: string },
): AuditEventInput {
  return {
    actor: ctx.actor,
    org: ctx.org,
    action: EGRESS_DLP_POLICY_ACTION,
    resource: `egress-dlp:${after.enabled ? 'on' : 'off'}:${after.strictness} (was ${before.enabled ? 'on' : 'off'}:${before.strictness})`,
    outcome: 'ok',
  };
}
