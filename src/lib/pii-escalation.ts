// PURE PII-masking ESCALATION rule (PA-16c) — ZERO imports of db/IO, exhaustively unit-testable.
//
// The gap this closes: a pipeline's guardrail OVERLAY can tighten PII masking ON *above* the org
// floor, but until now every run path re-implemented the "should I mask, and what does the model
// actually see?" dance inline — reading verdict.requirePiiMasking, then calling maskTextForModel —
// duplicated across agentrun / pipeline-execute / chat-run / app-run. Duplicated logic drifts. This
// module makes the DECISION live in exactly ONE pure place, reused by every run path:
//
//   effectivePiiMasking(floorRequired, verdict)  → does masking apply? = max(floor, overlay)
//   applyPiiEscalation(text, required, scan)      → the outbound text + whether it escalated
//
// It composes the EXISTING pure primitives, never re-deriving them:
//   • enforceModelCall already merges org floor + pipeline overlay (effectiveGovernance) and emits
//     verdict.requirePiiMasking — the escalated value. We treat that verdict as the overlay signal
//     and OR it with an explicit floor bit so a caller can never accidentally *lower* masking below
//     the floor (max, not replace).
//   • maskTextForModel (guardrail-rules-runtime) performs the raw→redacted substitution. We reuse it
//     verbatim; this module only decides WHEN it applies and reports the escalation outcome.

import { maskTextForModel, type PiiScanLike } from '@/lib/guardrail-rules-runtime';
import type { ModelCallVerdict } from '@/lib/pipeline-enforcement';

/**
 * The effective PII-masking decision for a model call: the MAX of the org floor and the pipeline
 * overlay (masking-on can only escalate, never be loosened below the floor). PURE.
 *
 * `floorRequired` is the org-locked floor bit (true when the org baseline mandates masking); the
 * verdict's `requirePiiMasking` already reflects the merged floor+overlay via effectiveGovernance,
 * but we OR the two so a mis-wired verdict can NEVER report less masking than the floor demands. A
 * null verdict (no pipeline bound) contributes nothing — then only the floor applies (legacy).
 */
export function effectivePiiMasking(
  floorRequired: boolean,
  verdict: Pick<ModelCallVerdict, 'requirePiiMasking'> | null,
): boolean {
  return floorRequired || (verdict?.requirePiiMasking ?? false);
}

/**
 * The effective prompt-injection-block decision for a model call: MAX of floor and overlay. PURE.
 * Same max-not-replace guarantee as masking — an overlay can escalate injection defence on, never
 * turn the org floor off.
 */
export function effectiveBlockPromptInjection(
  floorRequired: boolean,
  verdict: Pick<ModelCallVerdict, 'blockPromptInjection'> | null,
): boolean {
  return floorRequired || (verdict?.blockPromptInjection ?? false);
}

/** The outcome of applying (or skipping) PII escalation to a piece of outbound text. */
export interface PiiEscalationResult {
  /** The text that should actually reach the model (redacted when masking applied AND PII was found). */
  text: string;
  /** true ⇒ masking was required AND the scan produced a redacted form differing from the input. */
  masked: boolean;
  /** true ⇒ masking was required for this call (whether or not any PII was actually present). */
  required: boolean;
}

/**
 * Given the raw outbound text, whether masking is required for this call, and a PII scan of the text,
 * return the text that should reach the model + whether the raw value was actually substituted. PURE.
 *
 * Semantics (the single authority every run path shares):
 *   • required === false ⇒ the text is returned UNCHANGED (additive/legacy: no pipeline, or masking
 *     not escalated ⇒ the raw prompt is untouched). `masked: false`.
 *   • required === true  ⇒ the text is run through maskTextForModel: if the scan found PII and
 *     produced a differing redacted form, the REDACTED text is returned (`masked: true`) so the raw
 *     PAN/email never leaves; if the scan found nothing to redact, the original stands (`masked:
 *     false`) — masking was required but there was simply nothing to mask.
 *
 * Isolating this makes the "raw value is replaced before the model when the overlay escalates
 * masking" invariant directly unit-testable without any run-path I/O.
 */
export function applyPiiEscalation(
  text: string,
  required: boolean,
  scan: PiiScanLike,
): PiiEscalationResult {
  if (!required) return { text, masked: false, required: false };
  const redacted = maskTextForModel(text, scan);
  return { text: redacted, masked: redacted !== text, required: true };
}

/** The terminal decision for a PII-mask attempt that may have FAILED (the masker threw). */
export interface PiiMaskDecision {
  /** true ⇒ masking was required but the masker errored ⇒ the run must BLOCK (never emit raw text). */
  block: boolean;
  /** The text safe to forward (the redacted form, or the original when masking wasn't required). */
  text: string;
  /** true ⇒ a raw→redacted substitution was actually applied. */
  masked: boolean;
  /** Reason when blocked (the masker error), else null. */
  reason: string | null;
}

/**
 * FAIL-CLOSED PII masking (SECURITY #236 fix 2). PURE. Given whether masking is required, the raw
 * text, and the result of the (possibly failed) scan, decide the terminal outcome:
 *   • not required            ⇒ { block:false, text (unchanged), masked:false }.
 *   • required + scan ok       ⇒ apply the escalation; forward the redacted text.
 *   • required + scan ERRORED  ⇒ { block:true }: masking was mandated but could not run, so the raw
 *     (unmasked) text must NEVER be emitted — the run blocks. This is the invariant the old inline
 *     `catch { /* send unmasked *\/ }` violated (fail-open PII leak).
 *
 * `scanResult` is a discriminated result so the caller's try/catch around the (I/O) scan is thin:
 * pass { ok:true, scan } on success or { ok:false, error } when the masker threw. One authority,
 * reused by every run path — no path re-decides "what happens when the masker dies".
 */
export function maskOrBlock(
  required: boolean,
  text: string,
  scanResult: { ok: true; scan: PiiScanLike } | { ok: false; error: unknown },
): PiiMaskDecision {
  if (!required) return { block: false, text, masked: false, reason: null };
  if (!scanResult.ok) {
    const reason =
      scanResult.error instanceof Error ? scanResult.error.message : String(scanResult.error);
    return { block: true, text, masked: false, reason: `PII masking required but the masker failed: ${reason}` };
  }
  const esc = applyPiiEscalation(text, true, scanResult.scan);
  return { block: false, text: esc.text, masked: esc.masked, reason: null };
}
