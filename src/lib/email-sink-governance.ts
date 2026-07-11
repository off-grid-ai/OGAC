// PURE email-sink GOVERNANCE rules — ZERO imports of db/IO, exhaustively unit-testable.
//
// The Resend sink is a CLOUD delivery: an app-run's outcome leaves the box to a third-party API. The
// SMTP sink is air-gapped (only the operator's on-prem host), so it needs no egress leash. The email
// OUTPUT step must therefore make TWO governance decisions before it hands a body to a sink, and both
// must reuse the SAME pure authorities every other run path uses — never re-implemented here:
//
//   1. selectEmailProvider(step)      — which sink? ('resend' | 'smtp'), from the step config.
//   2. emailEgressVerdict(contract, provider) — may this delivery leave the box? For a CLOUD provider
//      (resend) this is the pipeline egress leash for the OUTPUT data-class: a 'block'/'local' verdict
//      DENIES the send (a local-only pipeline must not fan out to a cloud mailer). For the air-gapped
//      SMTP provider egress is irrelevant → always allowed.
//   3. maskEmailForSend(subject, text, required, scanSubject, scanText) — PII masking of the OUTBOUND
//      subject + body BEFORE the send, exactly the applyPiiEscalation() the model path uses.
//
// SOLID: this is the unit-testable brain shared by executeOutputStep. It composes enforceModelCall
// (the egress leash) + applyPiiEscalation (the mask) + effectivePiiMasking (the mask-required
// authority); it owns no I/O.

import type { PiiScanLike } from '@/lib/guardrail-rules-runtime';
import { applyPiiEscalation, effectivePiiMasking } from '@/lib/pii-escalation';
import { enforceModelCall, type PipelineContract } from '@/lib/pipeline-enforcement';

export type EmailProvider = 'resend' | 'smtp';

/**
 * Decide which email sink to use from the output step config. PURE. Defaults to SMTP (the air-gapped
 * on-prem sink) so an existing app with no explicit provider keeps its behaviour; `provider: 'resend'`
 * (or the legacy `via: 'resend'`) selects the governed cloud sink. Any other value falls back to SMTP.
 */
export function selectEmailProvider(config: Record<string, unknown> | undefined): EmailProvider {
  const raw = config?.provider ?? config?.via;
  return raw === 'resend' ? 'resend' : 'smtp';
}

/** The egress-leash verdict for an email delivery of the given provider. PURE. */
export interface EmailEgressVerdict {
  /** true ⇒ the send may leave the box; false ⇒ the pipeline egress leash denies it. */
  allow: boolean;
  /** The effective egress the leash produced (echoed for the audit trail). */
  egress: string;
  /** Human reason (for the governed step detail + audit). */
  reason: string;
}

/**
 * Decide whether an email delivery may leave the box. PURE.
 *
 * - SMTP (air-gapped) → ALWAYS allowed: it only ever reaches the operator's own on-prem host, so the
 *   cloud egress leash does not apply (there is no external egress to leash).
 * - RESEND (cloud) → the pipeline egress leash for the 'general' data-class (the run's outcome carries
 *   whatever the pipeline touched). A 'block' OR 'local' effective egress DENIES the send: a pipeline
 *   leashed to on-prem-only must not fan its result out through a third-party mailer. 'cloud'/'allow'
 *   permits it. With NO pipeline bound the leash is permissive (legacy) → allowed.
 */
function emailEgressReason(
  allow: boolean,
  verdict: { egress: string; forceLocal: boolean; reason: string },
): string {
  if (allow) return `egress "${verdict.egress}" permits cloud email delivery`;
  if (verdict.forceLocal) {
    return 'pipeline egress leashed to LOCAL — a cloud mailer (Resend) is not permitted; use the on-prem SMTP sink';
  }
  return `pipeline egress leash blocked cloud email delivery (${verdict.reason})`;
}

export function emailEgressVerdict(
  contract: PipelineContract | null,
  provider: EmailProvider,
): EmailEgressVerdict {
  if (provider === 'smtp') {
    return { allow: true, egress: 'local', reason: 'SMTP sink is air-gapped (on-prem host only) — no cloud egress' };
  }
  const verdict = enforceModelCall(contract, 'general');
  // A cloud mailer requires a non-local egress. block → denied; local → denied (stay on-prem); else allow.
  const allow = verdict.allow && !verdict.forceLocal;
  return {
    allow,
    egress: verdict.egress,
    reason: emailEgressReason(allow, verdict),
  };
}

/** Whether PII masking is required for this email delivery (org floor OR pipeline overlay). PURE. */
export function emailMaskingRequired(contract: PipelineContract | null): boolean {
  // Reuse the ONE authority: the model-call verdict already merges org floor + pipeline overlay.
  const verdict = contract ? enforceModelCall(contract, 'general') : null;
  return effectivePiiMasking(false, verdict);
}

/** The masked outbound subject + body + whether anything was redacted. PURE. */
export interface MaskedEmail {
  subject: string;
  text: string;
  masked: boolean;
}

/**
 * Mask the OUTBOUND subject + body before the send. PURE — the raw→redacted substitution is the SAME
 * applyPiiEscalation() the model path uses (one authority, no drift). When masking isn't required the
 * text is returned unchanged (additive/legacy). `masked` is true if either field was actually redacted.
 */
export function maskEmailForSend(
  subject: string,
  text: string,
  required: boolean,
  scanSubject: PiiScanLike,
  scanText: PiiScanLike,
): MaskedEmail {
  const s = applyPiiEscalation(subject, required, scanSubject);
  const t = applyPiiEscalation(text, required, scanText);
  return { subject: s.text, text: t.text, masked: s.masked || t.masked };
}
