// ─── PROVISIONING SERVICE CREDENTIALS INTO THE VAULT ──────────────────────────────────────────────
//
// Phase B of docs/INTEGRATION_ARCHITECTURE.md is "move each service's credential env → OpenBao". The
// broker that READS them already exists (service-credentials.ts) and the adapters already prefer it —
// what was missing is any way to PUT a secret there without editing `.env.local` over SSH. A secret
// sitting in a plaintext file on the box is the thing we are trying to stop, and telling an operator
// to edit that file is not a fix.
//
// The pure parts (which services are provisionable, which fields each credential kind needs, and what
// counts as a valid submission) are isolated and unit-testable; the vault write is a thin adapter.
//
// Secrets are WRITE-ONLY by design. Nothing here reads a secret VALUE back — only whether one exists.
// A console that can read back what it stored is just a second copy of the secret.

import {
  apiTokenKey,
  credentialPlan,
  publicKeyKey,
  s3AccessKeyKey,
  s3SecretKeyKey,
  secretKeyKey,
  type CredentialMode,
} from '@/lib/service-credentials-lib';

/** Services whose credential an operator can provision from the console. PURE. */
export function provisionableServices(): string[] {
  return ['langfuse', 'fleet', 'seaweedfs'];
}

/** The env var a deployment falls back to when the vault has nothing, per service. PURE. */
export function legacyEnvNames(service: string): string[] {
  switch (service) {
    case 'langfuse':
      return ['OFFGRID_LANGFUSE_AUTH', 'OFFGRID_LANGFUSE_PUBLIC_KEY', 'OFFGRID_LANGFUSE_SECRET_KEY'];
    case 'fleet':
      return ['OFFGRID_FLEET_TOKEN', 'FLEET_TOKEN'];
    case 'seaweedfs':
      return ['OFFGRID_S3_ACCESS_KEY', 'OFFGRID_S3_SECRET_KEY'];
    default:
      return [];
  }
}

export interface CredentialSecretInput {
  service: string;
  /** `native-bearer` — the API token. */
  token?: string;
  /** `native-basic` / `s3` — the keypair. */
  publicKey?: string;
  secretKey?: string;
}

export type SecretValidation =
  | { ok: true; value: CredentialSecretInput }
  | { ok: false; reason: string };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Validate a submitted credential against the service's PLAN. PURE.
 *
 * The plan decides which fields are required, so an operator cannot store a keypair for a service
 * that authenticates with a bearer token — the broker would read the wrong leaves and silently
 * resolve to no-credential, which looks like "configured" but authenticates nothing.
 */
export function validateCredentialSecret(input: unknown): SecretValidation {
  const body = (input ?? {}) as Partial<CredentialSecretInput>;
  const service = str(body.service);
  if (!provisionableServices().includes(service)) {
    return { ok: false, reason: `unknown or non-provisionable service: ${service || '(missing)'}` };
  }

  const mode: CredentialMode = credentialPlan(service).mode;
  if (mode === 'native-bearer') {
    const token = str(body.token);
    if (!token) return { ok: false, reason: `${service} authenticates with an API token — \`token\` is required` };
    return { ok: true, value: { service, token } };
  }
  if (mode === 'native-basic' || mode === 's3') {
    const publicKey = str(body.publicKey);
    const secretKey = str(body.secretKey);
    const label = mode === 's3' ? 'an access key + secret key' : 'a public key + secret key';
    if (!publicKey || !secretKey) {
      return { ok: false, reason: `${service} authenticates with ${label} — both are required` };
    }
    return { ok: true, value: { service, publicKey, secretKey } };
  }
  return { ok: false, reason: `${service} has no provisionable credential (plan: ${mode})` };
}

/** The vault leaves a service's credential occupies, in plan order. PURE. */
export function credentialLeaves(service: string): string[] {
  switch (credentialPlan(service).mode) {
    case 'native-bearer':
      return [apiTokenKey(service)];
    case 'native-basic':
      return [publicKeyKey(service), secretKeyKey(service)];
    case 's3':
      return [s3AccessKeyKey(service), s3SecretKeyKey(service)];
    default:
      return [];
  }
}

// ─── thin vault I/O ───────────────────────────────────────────────────────────────────────────────

/** Write the credential into OpenBao. Throws if the backend is unwritable, so the route can 500. */
export async function storeCredentialSecret(value: CredentialSecretInput): Promise<void> {
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.set) throw new Error('secrets backend is not writable');
  const mode = credentialPlan(value.service).mode;
  if (mode === 'native-bearer') {
    await openBaoSecrets.set(apiTokenKey(value.service), value.token!);
    return;
  }
  const [pubLeaf, secLeaf] = credentialLeaves(value.service);
  await openBaoSecrets.set(pubLeaf, value.publicKey!);
  await openBaoSecrets.set(secLeaf, value.secretKey!);
}

/** Remove every leaf of a service's credential. Returns whether anything was actually there. */
export async function removeCredentialSecret(service: string): Promise<boolean> {
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  let existed = false;
  for (const leaf of credentialLeaves(service)) {
    try {
      const current = await openBaoSecrets.get(leaf);
      if (typeof current === 'string' && current.trim()) existed = true;
      if (openBaoSecrets.remove) await openBaoSecrets.remove(leaf);
    } catch {
      /* a missing leaf is not an error — removal is idempotent */
    }
  }
  return existed;
}

export interface CredentialState {
  service: string;
  mode: CredentialMode;
  /** True when every leaf the plan needs is present in the vault. */
  vaulted: boolean;
  /** Env vars that would be used if the vault has nothing — named so an operator can go remove them. */
  legacyEnv: string[];
  /** Which env fallbacks are actually set on this deployment right now. */
  legacyEnvPresent: string[];
  /** What is genuinely in force. */
  source: 'vault' | 'env' | 'none';
}

/** Report, per provisionable service, where its credential actually comes from. Never throws. */
export async function credentialInventory(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CredentialState[]> {
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  const out: CredentialState[] = [];

  for (const service of provisionableServices()) {
    const mode = credentialPlan(service).mode;
    const leaves = credentialLeaves(service);
    let vaulted = leaves.length > 0;
    for (const leaf of leaves) {
      try {
        const v = await openBaoSecrets.get(leaf);
        if (!(typeof v === 'string' && v.trim())) vaulted = false;
      } catch {
        vaulted = false;
      }
    }
    const legacyEnv = legacyEnvNames(service);
    const legacyEnvPresent = legacyEnv.filter((name) => Boolean((env[name] ?? '').trim()));
    out.push({
      service,
      mode,
      vaulted,
      legacyEnv,
      legacyEnvPresent,
      // The vault wins wherever it is populated; otherwise say honestly whether anything is in force.
      source: vaulted ? 'vault' : legacyEnvPresent.length > 0 ? 'env' : 'none',
    });
  }
  return out;
}
