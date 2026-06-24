import { createHash } from 'crypto';
import { getSigning } from '@/lib/adapters/registry';

// Detached provenance for exported files (reports, etc.). C2PA targets media; a report is text/PDF,
// so we attach a DETACHED manifest instead: the file's SHA-256 + metadata, signed by the active
// signing port (ed25519 by default — offline-verifiable with only the public key, no shared secret,
// no fees). The manifest travels alongside the file; anyone can recompute the hash and verify the
// signature with the published public key.
export interface ProvenanceManifest {
  generator: string;
  filename: string;
  format: string;
  sha256: string;
  generatedAt: string;
  algorithm: string;
  publicKey: string | null;
  signature: string;
}

const GENERATOR = 'offgrid-console/1.0';

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// The fields the signature covers (everything except the signature itself) — canonicalized by the
// signing port so verification is deterministic.
function signedFields(m: Omit<ProvenanceManifest, 'signature' | 'algorithm' | 'publicKey'>) {
  return { generator: m.generator, filename: m.filename, format: m.format, sha256: m.sha256, generatedAt: m.generatedAt };
}

export function buildManifest(
  bytes: Uint8Array,
  filename: string,
  format: string,
  generatedAt: string,
): ProvenanceManifest {
  const signing = getSigning();
  const core = { generator: GENERATOR, filename, format, sha256: sha256(bytes), generatedAt };
  return {
    ...core,
    algorithm: signing.algorithm,
    publicKey: signing.publicKey(),
    signature: signing.sign(signedFields(core)),
  };
}

export interface VerifyResult {
  signatureValid: boolean;
  hashMatches?: boolean;
  algorithm: string;
}

// Verify a manifest's signature (and, if a hash is supplied, that it matches the file the caller
// holds). Uses the active signing port — for ed25519 this needs only the public key.
export function verifyManifest(manifest: ProvenanceManifest, sha256Hex?: string): VerifyResult {
  const signing = getSigning();
  const signatureValid = signing.verify(signedFields(manifest), manifest.signature);
  return {
    signatureValid,
    hashMatches: sha256Hex !== undefined ? sha256Hex === manifest.sha256 : undefined,
    algorithm: signing.algorithm,
  };
}
