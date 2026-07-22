// PURE outbound-sink GOVERNANCE — the ONE unit-testable brain every outbound action plugs into.
//
// Today the email OUTPUT step made two governance decisions inline (egress leash + PII-mask-before-
// send) via email-sink-governance.ts. As the platform grows more outbound actions (webhook, Slack,
// WhatsApp, and future connectors), that SAME sequence must run for every cloud sink — never
// re-implemented per sink. This module is that shared, zero-IO authority:
//
//   1. cloudEgressVerdict(contract, transport)  — may this delivery leave the box? An AIR-GAPPED
//      transport (on-prem SMTP / on-prem WhatsApp gateway) is always allowed (no external egress to
//      leash). A CLOUD transport (Resend, an arbitrary webhook URL, Slack's cloud webhook) is gated by
//      the pipeline egress leash for the run's data-class: a `block`/`local` effective egress DENIES
//      the send — a pipeline leashed on-prem must not fan its result out to a third-party endpoint.
//   2. maskTextForSend(text, required, scan)     — PII masking of the OUTBOUND body BEFORE it crosses
//      the wire, reusing the SAME applyPiiEscalation() the model path + email sink use (one authority).
//   3. sinkMaskingRequired(contract)             — org floor OR pipeline overlay requires masking?
//
// SOLID: this composes enforceModelCall (the leash) + applyPiiEscalation (the mask) +
// effectivePiiMasking (the mask-required authority). It owns NO I/O. email-sink-governance.ts now
// delegates its egress verdict here so the two never drift.

import type { PiiScanLike } from '@/lib/guardrail-rules-runtime';
import { applyPiiEscalation, effectivePiiMasking } from '@/lib/pii-escalation';
import { enforceModelCall, type PipelineContract } from '@/lib/pipeline-enforcement';

/**
 * How a sink physically reaches its destination:
 *  - 'air-gapped' → only the operator's own on-prem host (SMTP, on-prem WhatsApp gateway). No cloud
 *    egress exists to leash, so the egress leash never applies.
 *  - 'cloud'      → a third-party / arbitrary external endpoint (Resend, a webhook URL, Slack). The
 *    pipeline egress leash decides whether the run's outcome may leave the box at all.
 */
export type SinkTransport = 'air-gapped' | 'cloud';

/** The egress-leash verdict for one outbound delivery. PURE. */
export interface SinkEgressVerdict {
  /** true ⇒ the send may leave the box; false ⇒ the pipeline egress leash denies it. */
  allow: boolean;
  /** The effective egress the leash produced (echoed for the audit trail). */
  egress: string;
  /** Human reason (for the governed step detail + audit). */
  reason: string;
}

function egressReason(
  allow: boolean,
  transportLabel: string,
  verdict: { egress: string; forceLocal: boolean; reason: string },
): string {
  if (allow) return `egress "${verdict.egress}" permits cloud ${transportLabel} delivery`;
  if (verdict.forceLocal) {
    return `pipeline egress leashed to LOCAL — a cloud ${transportLabel} sink is not permitted; keep the outcome on-prem`;
  }
  return `pipeline egress leash blocked cloud ${transportLabel} delivery (${verdict.reason})`;
}

/**
 * Decide whether an outbound delivery over `transport` may leave the box. PURE.
 *
 * - air-gapped → ALWAYS allowed (only ever reaches the operator's own host; nothing to leash).
 * - cloud → the pipeline egress leash for the 'general' data-class (the run's outcome carries whatever
 *   the pipeline touched). A 'block' OR 'local' effective egress DENIES the send. 'cloud'/'allow'
 *   permits it. With NO pipeline bound the leash is permissive (legacy) → allowed.
 *
 * `transportLabel` is a human word for the sink kind ("webhook", "Slack message", "email") woven into
 * the audit reason so the ledger reads clearly — it does NOT change the decision.
 */
export function cloudEgressVerdict(
  contract: PipelineContract | null,
  transport: SinkTransport,
  transportLabel = 'delivery',
): SinkEgressVerdict {
  if (transport === 'air-gapped') {
    return {
      allow: true,
      egress: 'local',
      reason: `${transportLabel} sink is air-gapped (on-prem host only) — no cloud egress`,
    };
  }
  const verdict = enforceModelCall(contract, 'general');
  // A cloud sink requires a non-local egress. block → denied; local → denied (stay on-prem); else allow.
  const allow = verdict.allow && !verdict.forceLocal;
  return { allow, egress: verdict.egress, reason: egressReason(allow, transportLabel, verdict) };
}

/** Whether PII masking is required for an outbound delivery (org floor OR pipeline overlay). PURE. */
export function sinkMaskingRequired(contract: PipelineContract | null): boolean {
  // Reuse the ONE authority: the model-call verdict already merges org floor + pipeline overlay.
  const verdict = contract ? enforceModelCall(contract, 'general') : null;
  return effectivePiiMasking(false, verdict);
}

/** The masked outbound text + whether anything was redacted. PURE. */
export interface MaskedText {
  text: string;
  masked: boolean;
}

/**
 * Mask an OUTBOUND text field before the send. PURE — the raw→redacted substitution is the SAME
 * applyPiiEscalation() the model path uses (one authority, no drift). When masking isn't required the
 * text is returned unchanged (additive/legacy). `masked` is true if the field was actually redacted.
 */
export function maskTextForSend(text: string, required: boolean, scan: PiiScanLike): MaskedText {
  const r = applyPiiEscalation(text, required, scan);
  return { text: r.text, masked: r.masked };
}
