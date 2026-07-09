// Provenance operations — the I/O seam for the on-demand VERIFY and ROTATE actions on the
// Provenance surface. Thin: it loads the run, calls the active signing port, and hands the result
// to the PURE classifier/planner in `provenance-verify.ts`. The verdict logic lives there so it's
// unit-testable without a DB or a key; this file only wires real I/O to it.

import { generateKeyPairSync } from 'crypto';
import { getSigning } from '@/lib/adapters/registry';
import {
  classifyVerification,
  rebuildRunPayload,
  type RotationPlan,
  rotationPlan,
  type VerificationVerdict,
} from '@/lib/provenance-verify';

export interface RunVerifyResult extends VerificationVerdict {
  runId: string;
  algorithm: string;
  signedAt: string | null;
  // The public key the record was signed under (from the stored provenance), if any.
  manifestPublicKey: string | null;
  // The active signing port's public key right now, if any.
  activePublicKey: string | null;
}

/**
 * Verify a single agent-run's stored signature against the ACTIVE signing key, HONESTLY.
 * Returns null only when the run itself is unknown; a run with no provenance yields an 'unsigned'
 * verdict. Never throws — a failure to evaluate the signature degrades to a key-mismatch verdict.
 */
export async function verifyRunProvenance(
  runId: string,
  orgId?: string,
): Promise<RunVerifyResult | null> {
  const { getAgentRun } = await import('@/lib/agentrun');
  // Org-scope the lookup so provenance verify is not a cross-tenant IDOR and a non-default org's run
  // resolves (getAgentRun is org-scoped as of Wave 2). Omitting orgId falls back to DEFAULT_ORG.
  const run = await getAgentRun(runId, orgId);
  if (!run) return null;

  const signing = getSigning();
  const activePublicKey = signing.publicKey();
  const p = run.provenance;

  if (!p || typeof p.signature !== 'string' || !p.signature) {
    const verdict = classifyVerification({ hasSignature: false, signatureValid: null });
    return {
      ...verdict,
      runId,
      algorithm: signing.algorithm,
      signedAt: p?.signedAt ?? null,
      manifestPublicKey: p?.publicKey ?? null,
      activePublicKey,
    };
  }

  // Re-verify against the EXACT payload that was signed (shared rebuild = single source of truth).
  let signatureValid: boolean | null = null;
  try {
    signatureValid = signing.verify(rebuildRunPayload(run), p.signature);
  } catch {
    signatureValid = null; // could not evaluate → honest key-mismatch, never a false "verified"
  }

  const verdict = classifyVerification({
    hasSignature: true,
    signatureValid,
    manifestPublicKey: p.publicKey,
    activePublicKey,
  });

  return {
    ...verdict,
    runId,
    algorithm: p.algorithm ?? signing.algorithm,
    signedAt: p.signedAt ?? null,
    manifestPublicKey: p.publicKey ?? null,
    activePublicKey,
  };
}

export interface RotateResult {
  plan: RotationPlan;
  // A freshly generated ed25519 keypair for the operator to install, when the adapter supports it.
  generated?: { publicKeyPem: string; privateKeyPem: string };
  // The public key currently in force (so the operator knows what's live before rotating).
  currentPublicKey: string | null;
  algorithm: string;
}

/**
 * Plan (and, where possible, materialize) a signing-key rotation. The console process cannot durably
 * rewrite a server-managed env var / KMS from a web request, so this generates a fresh keypair for
 * the operator to install and returns the HONEST remaining step. It NEVER pretends the live key was
 * swapped. Never throws.
 */
export function rotateSigningKey(): RotateResult {
  const signing = getSigning();
  const hasEnvPem = Boolean(process.env.OFFGRID_ED25519_PRIVATE_KEY);
  const plan = rotationPlan(signing.algorithm, hasEnvPem);

  let generated: RotateResult['generated'];
  if (plan.supportsKeypair) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    generated = {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  }

  return {
    plan,
    generated,
    currentPublicKey: signing.publicKey(),
    algorithm: signing.algorithm,
  };
}
