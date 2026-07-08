// Provenance verification — the PURE rules for turning a raw verify attempt into an honest,
// operator-facing verdict, plus the deterministic rebuild of the payload an agent-run signs.
//
// SOLID split (mirror of tenancy-policy / provenance-view):
//   - This file is ZERO-IO and ZERO-import beyond types: unit-testable in isolation. It NEVER
//     touches the signing port, the DB, or the network. It only classifies inputs.
//   - The I/O (loading the run, calling `getSigning().verify`, auditing) lives in the route handler
//     and in `provenance-view.ts`.
//
// Honesty is the whole point: we distinguish verified / tampered / key-mismatch / unsigned so the
// console never shows a green "verified" it can't stand behind.

// The exact fields an agent-run signature covers, in the exact shape `runAgent` signs (agentrun.ts).
// `provenanceRef === runId` (correlation.ts), so the payload is bound to the run id. Any drift here
// makes verification silently fail — this is the single source of truth for that shape.
export interface SignedRunPayload {
  runId: string;
  agentId: string;
  query: string;
  answer: string;
  refs: string[];
}

// Minimal shape of a run needed to rebuild its signed payload — a structural subset of AgentRun so
// this file needs no import of the heavy agentrun module.
export interface RunLike {
  id: string;
  agentId: string;
  query: string;
  answer: string;
  citations: readonly { ref: string }[];
}

/**
 * PURE. Rebuild the exact payload `runAgent` signed for a given run. Deterministic — same run in,
 * same bytes out — so re-verification is byte-identical to signing. Never throws.
 */
export function rebuildRunPayload(run: RunLike): SignedRunPayload {
  return {
    runId: run.id, // provenanceRef === runId
    agentId: run.agentId,
    query: run.query,
    answer: run.answer,
    refs: (run.citations ?? []).map((c) => c.ref),
  };
}

export type VerificationStatus = 'verified' | 'tampered' | 'key-mismatch' | 'unsigned';

export interface VerificationVerdict {
  status: VerificationStatus;
  // Human-readable, honest one-liner for the operator + the audit trail.
  detail: string;
  // Whether this counts as trustworthy provenance (only 'verified' does).
  ok: boolean;
}

export interface VerifyInput {
  // Did the record carry a signature at all?
  hasSignature: boolean;
  // Result of the signing port's verify() against the ACTIVE key. null when we couldn't run it.
  signatureValid: boolean | null;
  // The public key recorded ON the manifest at signing time (PEM), if any.
  manifestPublicKey?: string | null;
  // The public key of the ACTIVE signing port right now (PEM), if any.
  activePublicKey?: string | null;
}

// Normalize a PEM for comparison — strip header/footer, whitespace and line breaks so cosmetic
// differences (CRLF, trailing newline) don't read as a key mismatch. Returns '' for null/empty.
export function normalizePem(pem: string | null | undefined): string {
  if (typeof pem !== 'string') return '';
  return pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * PURE. Turn a verify attempt into an honest verdict. Never throws.
 *
 * Precedence:
 *   1. No signature at all              → 'unsigned'.
 *   2. Signature valid under active key → 'verified'.
 *   3. Signature invalid AND the manifest's recorded public key differs from the active key
 *      → 'key-mismatch' (the key was rotated / the record was signed by a different key — the
 *      content may be fine, we just can't verify it with the key we hold now).
 *   4. Signature invalid, same/unknown key → 'tampered' (content or signature was altered).
 */
export function classifyVerification(input: VerifyInput): VerificationVerdict {
  if (!input.hasSignature) {
    return { status: 'unsigned', ok: false, detail: 'No signature on this record — nothing to verify.' };
  }
  if (input.signatureValid === true) {
    return { status: 'verified', ok: true, detail: 'Signature verified against the active signing key.' };
  }

  const manifestKey = normalizePem(input.manifestPublicKey);
  const activeKey = normalizePem(input.activePublicKey);
  const keysDiffer = !!manifestKey && !!activeKey && manifestKey !== activeKey;

  if (input.signatureValid === null) {
    return {
      status: 'key-mismatch',
      ok: false,
      detail: 'Could not verify — the active signing port could not evaluate this signature.',
    };
  }

  if (keysDiffer) {
    return {
      status: 'key-mismatch',
      ok: false,
      detail:
        'Signature does not verify under the ACTIVE key, and the record was signed by a different ' +
        'key (likely rotated). Verify with the original public key to confirm the content.',
    };
  }

  return {
    status: 'tampered',
    ok: false,
    detail: 'Signature does NOT verify under the key that signed it — the content or signature was altered.',
  };
}

// ── Signing-key rotation (pure planning) ───────────────────────────────────────────────────────
// The ed25519 signing key is loaded from OFFGRID_ED25519_PRIVATE_KEY (PEM) at process start, or a
// process-stable pair is generated when that env is unset. The console process cannot durably
// rewrite a server-managed env var or the KMS from a web request, so "rotate" is HONEST about what
// it can and cannot do: it generates a fresh keypair for the operator to install, and surfaces the
// exact remaining step. We never silently swap the live key and pretend rotation happened.

export type SigningKeyMode = 'env-pem' | 'ephemeral' | 'hmac';

export interface RotationPlan {
  mode: SigningKeyMode;
  // Can the console apply the rotation itself (durably), or must an operator finish it?
  canApplyInProcess: boolean;
  // Honest, exact instruction for the deferred step (empty when canApplyInProcess).
  remainingStep: string;
  // Whether generating a new keypair is even meaningful for this adapter.
  supportsKeypair: boolean;
}

/**
 * PURE. Given the active signing algorithm and whether an env PEM is configured, describe what a
 * rotation can and cannot do from the console. Never throws. Drives both the API response and the
 * operator-facing copy so they can't drift.
 */
export function rotationPlan(algorithm: string, hasEnvPem: boolean): RotationPlan {
  const alg = algorithm.toLowerCase();
  const isAsymmetric = alg.includes('ed25519') || alg.includes('ecdsa');
  if (!isAsymmetric) {
    return {
      mode: 'hmac',
      canApplyInProcess: false,
      supportsKeypair: false,
      remainingStep:
        'The active provenance adapter is HMAC (shared-secret). Rotate its secret in the secrets ' +
        'store and switch OFFGRID_ADAPTER_PROVENANCE to ed25519 for asymmetric, publicly verifiable ' +
        'provenance. The console cannot rotate a shared secret from here.',
    };
  }
  if (hasEnvPem) {
    return {
      mode: 'env-pem',
      canApplyInProcess: false,
      supportsKeypair: true,
      remainingStep:
        'Install the generated private key as OFFGRID_ED25519_PRIVATE_KEY on the server and restart ' +
        'the console. The console cannot durably rewrite a server-managed env var from a web request. ' +
        'The new PUBLIC key is returned so you can publish it to verifiers; existing records stay ' +
        'verifiable with the OLD public key (they show as key-mismatch until re-verified with it).',
    };
  }
  return {
    mode: 'ephemeral',
    canApplyInProcess: false,
    supportsKeypair: true,
    remainingStep:
      'This deployment has no OFFGRID_ED25519_PRIVATE_KEY set, so the signing key is an ephemeral, ' +
      'process-stable pair that already changes on every restart. To rotate durably, install the ' +
      'generated private key as OFFGRID_ED25519_PRIVATE_KEY and restart. A fresh keypair is returned ' +
      'below for you to install.',
  };
}
