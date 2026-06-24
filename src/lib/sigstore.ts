import 'server-only';
import { type Bundle, sign, verify } from 'sigstore';

// Sigstore signing/attestation for artifacts & exports. Keyless: an OIDC identity token is
// exchanged at Fulcio for a short-lived cert, the signature is logged to the Rekor transparency
// log, and the result is a self-contained Sigstore bundle anyone can verify — no long-lived key to
// manage. Public-good Fulcio/Rekor are free + need no API key (fits the console's all-in-one,
// no-fees goal); set OFFGRID_FULCIO_URL / OFFGRID_REKOR_URL to point at a self-hosted instance.
//
// Signing needs an OIDC identity token (OFFGRID_SIGSTORE_IDENTITY_TOKEN, or per-request) — that's
// inherent to keyless signing, not a missing integration. Verification is fully standalone.
const FULCIO_URL = process.env.OFFGRID_FULCIO_URL; // default: public-good DEFAULT_FULCIO_URL
const REKOR_URL = process.env.OFFGRID_REKOR_URL;
const ENV_IDENTITY = process.env.OFFGRID_SIGSTORE_IDENTITY_TOKEN;

export function sigstoreSigningConfigured(): boolean {
  return Boolean(ENV_IDENTITY);
}

export interface SigstoreSignResult {
  bundle: Bundle;
}

// Sign a payload, producing a Sigstore bundle (keyless). Requires an OIDC identity token.
export async function sigstoreSign(payload: string, identityToken?: string): Promise<Bundle> {
  const token = identityToken ?? ENV_IDENTITY;
  if (!token) {
    throw new Error(
      'sigstore: an OIDC identity token is required for keyless signing (set OFFGRID_SIGSTORE_IDENTITY_TOKEN or pass identityToken)',
    );
  }
  return sign(Buffer.from(payload), {
    identityToken: token,
    ...(FULCIO_URL ? { fulcioURL: FULCIO_URL } : {}),
    ...(REKOR_URL ? { rekorURL: REKOR_URL } : {}),
  });
}

export interface SigstoreVerifyResult {
  valid: boolean;
  error?: string;
}

// Verify a Sigstore bundle against the (optional) original payload. Standalone — no token needed.
export async function sigstoreVerify(bundle: Bundle, payload?: string): Promise<SigstoreVerifyResult> {
  try {
    if (payload !== undefined) await verify(bundle, Buffer.from(payload));
    else await verify(bundle);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'verification failed' };
  }
}
