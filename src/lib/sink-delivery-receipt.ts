// ─── Sink delivery receipt — a structured, retained proof of a governed egress delivery ────────────
//
// When a governed App/agent run delivers its outcome to an egress sink (webhook / slack / whatsapp),
// the run must RETAIN a queryable, signed receipt of that action — not just a log line. This is the
// deliver-sink analogue of the CRM ActionReceipt: it records WHAT was sent WHERE, the transport's
// HTTP status, whether the payload was cryptographically signed (+ a digest of that signature), and
// whether PII was masked first. It is PURE (given a clock string) and unit-tested.
//
// SOLID: this owns the receipt shape + derivation only. The executor (app-run) builds it from the
// deliver result and attaches it to the step; persistence + rendering consume this shape.

import { createHash } from 'node:crypto';
import type { DeliverSinkKind } from '@/lib/adapters/sinks/registry';

export interface SinkDeliveryReceipt {
  kind: 'sink-delivery';
  sink: DeliverSinkKind;
  /** Where it was delivered (webhook URL / slack channel / whatsapp recipient). */
  destination: string;
  /** Transport HTTP status when the sink reports one (e.g. 200), else null. */
  httpStatus: number | null;
  /** Whether the delivered payload carried a cryptographic signature the receiver can verify. */
  signed: boolean;
  /** sha256 of the signature header value (proof-of-signing without leaking the signing secret), else null. */
  signatureDigest: string | null;
  /** Whether PII was masked in the body before sending. */
  masked: boolean;
  sentAt: string;
  orgId: string;
  runId: string;
  stepId: string;
  /** Stable per (org, run, step, sink, destination) — lets a replay recognise the same delivery. */
  idempotencyKey: string;
}

export interface BuildSinkDeliveryReceiptArgs {
  sink: DeliverSinkKind;
  destination: string;
  httpStatus: number | null;
  /** The signature header value the sink applied (webhook HMAC), if any. */
  signature: string | null;
  masked: boolean;
  orgId: string;
  runId: string;
  stepId: string;
  sentAt: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Build the retained delivery receipt. PURE (deterministic given the args incl. sentAt). */
export function buildSinkDeliveryReceipt(args: BuildSinkDeliveryReceiptArgs): SinkDeliveryReceipt {
  const signature = args.signature?.trim() ? args.signature.trim() : null;
  return {
    kind: 'sink-delivery',
    sink: args.sink,
    destination: args.destination,
    httpStatus: Number.isInteger(args.httpStatus) ? (args.httpStatus as number) : null,
    signed: signature !== null,
    signatureDigest: signature ? sha256(signature) : null,
    masked: args.masked === true,
    sentAt: args.sentAt,
    orgId: args.orgId,
    runId: args.runId,
    stepId: args.stepId,
    idempotencyKey: sha256(
      [args.orgId, args.runId, args.stepId, args.sink, args.destination].join('|'),
    ),
  };
}
