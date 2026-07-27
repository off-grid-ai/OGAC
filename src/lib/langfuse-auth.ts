// ─── ONE definition of "how do we authenticate to Langfuse" ───────────────────────────────────────
//
// This rule existed in THREE places: langfuse.ts and langfuse-http.ts each carried their own
// `legacyAuthHeader` (with a comment conceding the duplication was a temporary constraint), and
// qa/scoring.ts read `OFFGRID_LANGFUSE_AUTH` directly into a module-level constant. Three copies of
// one credential rule is exactly the drift the DRY bar exists to prevent — and the third copy had a
// real consequence: a module-load constant can never pick up a credential provisioned into the vault
// at runtime, so scoring would keep using the plaintext env value forever.
//
// Precedence, in one place: a vaulted broker keypair wins; else the legacy env credential; else none.
// Reading happens at CALL time, never at module load.

import { getServiceCredential } from '@/lib/service-credentials';
import { chooseLangfuseAuth } from '@/lib/service-credentials-lib';

export const b64 = (s: string): string => Buffer.from(s).toString('base64');

/**
 * The env-derived Basic header, or null. PURE (env injected).
 *
 * Two supported env shapes, in order: an explicit public/secret pair, else the pre-encoded OTLP auth
 * blob that the tracing config already uses.
 */
export function legacyLangfuseAuth(env: NodeJS.ProcessEnv = process.env): string | null {
  const pk = (env.OFFGRID_LANGFUSE_PUBLIC_KEY ?? '').trim();
  const sk = (env.OFFGRID_LANGFUSE_SECRET_KEY ?? '').trim();
  if (pk && sk) return `Basic ${b64(`${pk}:${sk}`)}`;
  const otlp = (env.OFFGRID_LANGFUSE_AUTH ?? '').trim();
  return otlp ? `Basic ${otlp}` : null;
}

/** The Basic header to send: vaulted keypair first, then the env fallback. Never throws. */
export async function langfuseAuthHeader(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const cred = await getServiceCredential('langfuse');
    return chooseLangfuseAuth(cred, legacyLangfuseAuth(env), b64);
  } catch {
    return legacyLangfuseAuth(env);
  }
}

/**
 * Synchronous "is Langfuse auth configured from env?" — env only, deliberately.
 *
 * The broker is async and returns `none` until provisioned, so a sync gate must NOT claim configured
 * on its behalf. Callers use this for the cheap "is this deployment wired at all" check; the async
 * header above is what actually authenticates.
 */
export function langfuseEnvAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return legacyLangfuseAuth(env) !== null;
}
