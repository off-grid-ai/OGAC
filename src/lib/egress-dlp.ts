// PURE egress-DLP DECISION layer — ZERO imports (mirrors tenancy-policy.ts / cloud-routing.ts):
// exhaustively unit-testable, no I/O. This is the LAST governed gate before an outbound request
// leaves the box to a CLOUD provider. It answers ONE question for a single request:
//
//   "Is masking REQUIRED before this content may egress — and, given the guardrail's sanitize
//    result, what actually egresses (the sanitized payload), or is the cloud call BLOCKED?"
//
// The thesis: use the best OUTSIDE (frontier/cloud) models on the enterprise's INSIDE moat, SAFELY.
// The enabler is that PII/secrets are stripped BEFORE a request leaves to a cloud route, enforced by
// DEFAULT and governed. This module owns that decision; the I/O seam (egress-dlp-run.ts) feeds it the
// guardrail's already-computed sanitize result (reusing the SAME guardrail engine — no re-implemented
// redaction here) and applies the verdict at the cloud-egress seam.
//
// INVARIANTS (never fall OPEN):
//   • on-prem route              → PASSTHROUGH. Data never leaves the box; nothing is masked and the
//                                  on-prem behaviour is byte-identical.
//   • cloud + DLP disabled       → PASSTHROUGH, but flagged unprotected (the operator explicitly, and
//                                  audibly, turned the leash OFF — an honest recorded state).
//   • cloud + DLP enabled        → masking REQUIRED:
//       – guardrail unavailable  → BLOCKED (fail-closed). A guardrail that cannot screen must NEVER be
//                                  bypassable by killing the engine; the cloud call is refused.
//       – strictness 'block' + PII detected → BLOCKED (refuse egress entirely, don't even send masked).
//       – otherwise              → MASKED: the guardrail's sanitized content is what egresses.

// ─── policy ─────────────────────────────────────────────────────────────────────────────────────

/** Where the resolved request is about to run. Only a `cloud` route can leak data off the box. */
export type EgressRouteTarget = 'on-prem' | 'cloud';

/**
 * What to do when PII is detected on a cloud-bound request:
 *   • 'mask'  — strip/mask the PII and forward the sanitized content (default; keeps cloud usable).
 *   • 'block' — refuse the cloud call entirely when ANY PII is present (nothing leaves, even masked).
 */
export type EgressStrictness = 'mask' | 'block';

export interface EgressDlpPolicy {
  /** Master switch. DEFAULT true — cloud egress protection is ON unless an admin opts out. */
  enabled: boolean;
  /** How to handle detected PII on a cloud route. DEFAULT 'mask'. */
  strictness: EgressStrictness;
}

export const DEFAULT_EGRESS_DLP_POLICY: EgressDlpPolicy = { enabled: true, strictness: 'mask' };

/**
 * Normalize a loose/persisted policy shape into a valid EgressDlpPolicy. PURE. A missing/garbage
 * value falls back to the secure DEFAULT (enabled, mask) — the protection is default-ON, so an
 * absent row can NEVER read as "off". Only an explicit `enabled === false` disables it.
 */
export function normalizeEgressPolicy(raw: unknown): EgressDlpPolicy {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EGRESS_DLP_POLICY };
  const r = raw as { enabled?: unknown; strictness?: unknown };
  const enabled = r.enabled === false ? false : true;
  const strictness: EgressStrictness = r.strictness === 'block' ? 'block' : 'mask';
  return { enabled, strictness };
}

// ─── the guardrail sanitize result the I/O seam hands in ──────────────────────────────────────────
// A DB/adapter-free normalization of the guardrail's PiiResult. The I/O seam maps getPii().scan()'s
// PiiResult onto this so THIS module never imports the adapter layer (stays zero-import, testable).

export interface EgressScan {
  /** false ⇒ NO guardrail engine is configured (URL unset). A cloud route cannot be verified ⇒ block. */
  configured: boolean;
  /** false ⇒ the engine was configured but could NOT screen (unreachable / errored / malformed) ⇒ block. */
  reachable: boolean;
  /** true ⇒ the engine flagged sensitive content (PII / secret / etc.). */
  hits: boolean;
  /** The entity/scanner types that flagged (for the decision record). */
  entities: string[];
  /** The guardrail's sanitized text — PII rewritten in place. Equals the original when nothing flagged. */
  sanitized: string;
}

// ─── verdict ───────────────────────────────────────────────────────────────────────────────────

export type EgressAction =
  | 'passthrough' // content leaves unchanged (on-prem, or DLP off, or screened-clean)
  | 'masked' //      the guardrail's sanitized content leaves in place of the original
  | 'blocked'; //    the cloud call is REFUSED (fail-closed / strictness-block)

export interface EgressDlpDecision {
  action: EgressAction;
  routeTarget: EgressRouteTarget;
  /** true ⇒ this route required masking before egress (a cloud route with DLP enabled). */
  maskingRequired: boolean;
  /** true ⇒ the guardrail actually screened this content (a real verdict was produced). */
  screened: boolean;
  /** The entity types masked/flagged, for the audited decision record. */
  masked: string[];
  /** What may actually egress: the original (passthrough), the sanitized text (masked), or '' (blocked). */
  content: string;
  /** true ⇒ a cloud route ran with DLP switched OFF — recorded so the unprotected egress is provable. */
  unprotected: boolean;
  /** Human-readable reason, carried into the audit decision record. */
  reason: string;
  policyEnabled: boolean;
  strictness: EgressStrictness;
}

/**
 * Is masking REQUIRED before content on this route may egress? PURE. Only a cloud route with the DLP
 * switch ON requires it. On-prem never leaves the box; a disabled switch is an explicit (audited)
 * opt-out. Exported so the enforcement seam can cheaply decide whether to even call the guardrail.
 */
export function egressMaskingRequired(routeTarget: EgressRouteTarget, policy: EgressDlpPolicy): boolean {
  return routeTarget === 'cloud' && policy.enabled === true;
}

/**
 * What egress DLP demands of a GOVERNED (app/agent) run's outbound content, given the egress the
 * bound pipeline PERMITS for the run ('local' | 'cloud' | 'block') and the org egress-DLP policy.
 * PURE, zero-import — so the run path enforces the SAME per-org policy the interactive chat seam does
 * (one authority; no second definition of "when does a run mask/block on cloud egress").
 *
 *   • maskFloor  — masking is REQUIRED before this run's content egresses: a cloud-permitted run under
 *                  an ENABLED policy. Fed as the floor bit into effectivePiiMasking(), so egress DLP
 *                  can only ESCALATE a run's masking on, never lower a pipeline overlay that's already
 *                  on. A local run contributes nothing (data never leaves the box).
 *   • blockOnPii — any PII detected in the outbound content must BLOCK the run (refuse), not merely
 *                  mask it: a cloud-permitted run whose policy strictness is 'block'. Mirrors the chat
 *                  seam's `strictness:'block' + hits ⇒ blocked` verdict.
 *
 * A 'block' or 'local' run egress demands nothing here: 'block' is already refused upstream by the
 * routing leash, and 'local' never egresses.
 */
export function egressDlpRunDemand(
  runEgress: string,
  policy: EgressDlpPolicy,
): { maskFloor: boolean; blockOnPii: boolean } {
  const cloud = runEgress === 'cloud' && policy.enabled === true;
  return { maskFloor: cloud, blockOnPii: cloud && policy.strictness === 'block' };
}

/**
 * Decide — and HOW — a request may egress. PURE, total (every branch returns a decision, none throws).
 *
 * @param routeTarget where the request will run ('on-prem' | 'cloud').
 * @param content     the outbound content the request would send.
 * @param policy      the org's egress-DLP policy (default enabled/mask).
 * @param scan        the guardrail's sanitize result, or null when it was NOT consulted. On a route
 *                    that requires masking, a null/unavailable scan FAILS CLOSED (blocked).
 */
export function enforceEgressDlp(
  routeTarget: EgressRouteTarget,
  content: string,
  policy: EgressDlpPolicy,
  scan: EgressScan | null,
): EgressDlpDecision {
  const base = {
    routeTarget,
    policyEnabled: policy.enabled,
    strictness: policy.strictness,
  } as const;

  // On-prem: data never leaves the box. Byte-identical passthrough, nothing screened.
  if (routeTarget === 'on-prem') {
    return {
      ...base,
      action: 'passthrough',
      maskingRequired: false,
      screened: false,
      masked: [],
      content,
      unprotected: false,
      reason: 'on-prem route — content stays on the box; no egress DLP applied',
    };
  }

  // Cloud + DLP switched OFF: an explicit, audited opt-out. The content leaves UNMASKED — recorded as
  // unprotected so the governance surface can prove the leash was off for this call.
  if (!policy.enabled) {
    return {
      ...base,
      action: 'passthrough',
      maskingRequired: false,
      screened: false,
      masked: [],
      content,
      unprotected: true,
      reason: 'cloud egress DLP is DISABLED by org policy — content left unmasked (unprotected)',
    };
  }

  // Cloud + DLP ON ⇒ masking is REQUIRED. Fail CLOSED if the guardrail could not verify the content.
  if (scan === null || scan.configured === false || scan.reachable === false) {
    const why =
      scan === null
        ? 'guardrail not consulted'
        : scan.configured === false
          ? 'guardrail engine not configured'
          : 'guardrail engine unreachable';
    return {
      ...base,
      action: 'blocked',
      maskingRequired: true,
      screened: false,
      masked: [],
      content: '',
      unprotected: false,
      reason: `cloud egress BLOCKED (fail-closed): ${why} — cannot verify PII was stripped`,
    };
  }

  // The guardrail screened the content. Strictness 'block' refuses egress outright when PII is present.
  if (policy.strictness === 'block' && scan.hits) {
    return {
      ...base,
      action: 'blocked',
      maskingRequired: true,
      screened: true,
      masked: scan.entities,
      content: '',
      unprotected: false,
      reason: `cloud egress BLOCKED: sensitive content detected (${describeEntities(scan.entities)}) and strictness is 'block'`,
    };
  }

  // Strictness 'mask' (or clean): the guardrail's sanitized content is what egresses.
  if (scan.hits) {
    return {
      ...base,
      action: 'masked',
      maskingRequired: true,
      screened: true,
      masked: scan.entities,
      content: scan.sanitized,
      unprotected: false,
      reason: `cloud egress MASKED before send: ${describeEntities(scan.entities)} stripped`,
    };
  }

  // Screened, nothing sensitive — the (unchanged) content is released to cloud, but it WAS screened.
  return {
    ...base,
    action: 'passthrough',
    maskingRequired: true,
    screened: true,
    masked: [],
    content: scan.sanitized,
    unprotected: false,
    reason: 'cloud egress screened — no sensitive content detected',
  };
}

/** Compact human list of masked entity types for a reason string. PURE. */
function describeEntities(entities: string[]): string {
  if (!entities.length) return 'sensitive content';
  return entities.join(', ');
}
