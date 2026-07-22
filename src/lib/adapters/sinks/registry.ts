// PURE outbound-sink REGISTRY + governance pipeline — the ONE dispatch seam every deliver-sink uses.
//
// Before this, executeOutputStep ran the governance sequence (egress leash → PII mask → deliver →
// honest-record) inline for email only, as one branch of a growing switch. Every NEW outbound action
// (webhook, Slack, WhatsApp, future connectors) needs that EXACT sequence — so it lives here ONCE:
//
//   • SINK_REGISTRY declares each deliver-sink's transport (air-gapped vs cloud) + a human label +
//     the config field that carries its destination (for the honest "no destination" degrade).
//   • planSinkGovernance(...) is the PURE pipeline: given the sink kind, the bound pipeline contract,
//     the run outcome, and (when masking is required) a PII scan of the body, it returns a DECISION —
//     either `blocked` (egress leash denied), `held` (masking required but the detector failed on a
//     cloud transport — refuse to leak), or `deliver` (the leash-approved, masked body + the audit
//     events to emit). It performs NO I/O: the caller (executeOutputStep) runs the scan, emits the
//     audits, and calls the sink's deliver fn — exactly the SMTP/Resend shape, now shared by all.
//
// SOLID: this composes sink-governance.ts (the shared egress/mask authority). It owns no I/O, no
// fetch, no vault, no DB — so it is exhaustively unit-testable.

import {
  cloudEgressVerdict,
  maskTextForSend,
  sinkMaskingRequired,
  type SinkTransport,
} from '@/lib/adapters/sinks/sink-governance';
import type { PiiScanLike } from '@/lib/guardrail-rules-runtime';
import type { PipelineContract } from '@/lib/pipeline-enforcement';

/** The outbound sinks that DELIVER text over a wire (governed the same way). Console/report differ. */
export type DeliverSinkKind = 'email' | 'webhook' | 'slack' | 'whatsapp';

export interface SinkDescriptor {
  kind: DeliverSinkKind;
  /** air-gapped (on-prem only, no egress leash) vs cloud (leash-gated). Email is decided per-provider. */
  transport: SinkTransport;
  /** Human word woven into audit reasons + step detail ("webhook", "Slack message", …). */
  label: string;
  /** The step-config key that names WHERE the sink delivers (for the honest "no destination" check). */
  destinationField: string;
}

// The static registry. Email is a special case (its transport depends on smtp/resend) so it resolves
// its transport dynamically in executeOutputStep via emailEgressVerdict; the entry here is the default
// (cloud) so a generic caller still gets a sane label/field. webhook + slack are cloud; whatsapp is an
// on-prem gateway (air-gapped, mirrors the SMTP + WhatsApp-trigger guarantee).
export const SINK_REGISTRY: Record<DeliverSinkKind, SinkDescriptor> = {
  email: { kind: 'email', transport: 'cloud', label: 'email', destinationField: 'to' },
  webhook: { kind: 'webhook', transport: 'cloud', label: 'webhook', destinationField: 'url' },
  slack: { kind: 'slack', transport: 'cloud', label: 'Slack message', destinationField: 'channel' },
  whatsapp: { kind: 'whatsapp', transport: 'air-gapped', label: 'WhatsApp message', destinationField: 'to' },
};

export function getSinkDescriptor(kind: DeliverSinkKind): SinkDescriptor {
  return SINK_REGISTRY[kind];
}

/** One audit event the pipeline decided to emit; the caller performs the I/O (auditEnforcement). */
export interface SinkAudit {
  action: string;
  resource: string;
  outcome: string;
  reason: string;
}

/** The pure governance decision for a deliver-sink. The caller acts on exactly one variant. */
export type SinkGovernanceDecision =
  | { verdict: 'blocked'; reason: string; audits: SinkAudit[] }
  | { verdict: 'held'; reason: string; audits: SinkAudit[] }
  | { verdict: 'deliver'; body: string; masked: boolean; audits: SinkAudit[] };

export interface PlanSinkGovernanceArgs {
  descriptor: SinkDescriptor;
  contract: PipelineContract | null;
  /** The run outcome to deliver (the raw body). */
  outcome: string;
  /**
   * When masking is required, the caller runs the PII scan (I/O) and passes it here. Absent means the
   * caller could NOT scan (detector down): on a CLOUD transport this HOLDS the send (refuse to leak);
   * on an AIR-GAPPED transport it proceeds unmasked (the body never leaves the box — leash guarantee).
   */
  scan?: PiiScanLike | null;
}

const resource = (d: SinkDescriptor) => `sink:${d.kind}`;

/**
 * The PURE governance pipeline shared by every deliver-sink. Returns the decision + the audit events
 * to emit; performs NO I/O. Sequence (mirrors the email path exactly):
 *   1. EGRESS LEASH — cloudEgressVerdict for the sink's transport. A deny ⇒ { blocked } + a deny audit.
 *   2. PII MASK — when masking is required: mask the body with the caller's scan. If the caller could
 *      not scan (scan == null) → HOLD on a cloud transport (refuse to leak), proceed unmasked on an
 *      air-gapped one. A redaction emits a mask audit.
 *   3. DELIVER — return the leash-approved, masked body for the caller to hand to the sink's deliver fn.
 */
export function planSinkGovernance(args: PlanSinkGovernanceArgs): SinkGovernanceDecision {
  const { descriptor, contract, outcome } = args;
  const audits: SinkAudit[] = [];

  // 1. EGRESS LEASH
  const egress = cloudEgressVerdict(contract, descriptor.transport, descriptor.label);
  if (!egress.allow) {
    return {
      verdict: 'blocked',
      reason: egress.reason,
      audits: [
        {
          action: 'pipeline.egress.block',
          resource: resource(descriptor),
          outcome: 'blocked',
          reason: egress.reason,
        },
      ],
    };
  }

  // 2. PII MASK BEFORE SEND
  let body = outcome;
  if (sinkMaskingRequired(contract)) {
    if (args.scan === null || args.scan === undefined) {
      // The caller couldn't scan (detector down). A cloud send is HELD (refuse to leak unmasked PII);
      // an air-gapped send proceeds — the body never crosses the wire (the leash guarantee holds).
      if (descriptor.transport === 'cloud') {
        const reason = `PII masking required but the detector is unavailable — ${descriptor.label} send held`;
        return {
          verdict: 'held',
          reason,
          audits: [
            {
              action: 'pipeline.pii.mask',
              resource: resource(descriptor),
              outcome: 'error',
              reason: `PII detector unavailable — cloud ${descriptor.label} held`,
            },
          ],
        };
      }
      // air-gapped: proceed unmasked (on-prem only) — record honestly that masking was skipped.
      audits.push({
        action: 'pipeline.pii.mask',
        resource: resource(descriptor),
        outcome: 'skipped',
        reason: `PII detector unavailable — ${descriptor.label} is air-gapped, body stays on-prem`,
      });
    } else {
      const masked = maskTextForSend(outcome, true, args.scan);
      body = masked.text;
      if (masked.masked) {
        audits.push({
          action: 'pipeline.pii.mask',
          resource: resource(descriptor),
          outcome: 'redacted',
          reason: `masked PII in ${descriptor.label} body before send`,
        });
      }
    }
  }

  return { verdict: 'deliver', body, masked: body !== outcome, audits };
}
