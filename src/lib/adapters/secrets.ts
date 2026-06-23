import type { SecretsPort } from './types';

// Secrets adapters. The default reads process.env (12-factor); for production a real KMS like
// OpenBao binds here without callers changing. OpenBao's admin UI is rich, so it renders as an
// SSO'd embed rather than something we rebuild.
export const envSecrets: SecretsPort = {
  meta: {
    id: 'env',
    capability: 'secrets',
    vendor: 'Process env',
    license: 'first-party',
    render: 'headless',
    description: 'Reads secrets from the environment (12-factor). Default for dev/on-prem.',
  },
  get: (key) => Promise.resolve(process.env[key]),
  has: (key) => Promise.resolve(process.env[key] !== undefined),
};

const BAO_URL = process.env.OFFGRID_OPENBAO_URL;
const BAO_TOKEN = process.env.OFFGRID_OPENBAO_TOKEN ?? 'offgrid-dev-token';
const BAO_MOUNT = process.env.OFFGRID_OPENBAO_MOUNT ?? 'secret';

// Read a KV v2 secret: GET <url>/v1/<mount>/data/<key> → data.data.value. Falls back to env
// when OpenBao isn't reachable so the console still runs without the secrets profile up.
async function baoGet(key: string): Promise<string | undefined> {
  if (!BAO_URL) return process.env[key];
  try {
    const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/data/${encodeURIComponent(key)}`, {
      headers: { 'X-Vault-Token': BAO_TOKEN },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return process.env[key];
    const json = await res.json();
    const value = json?.data?.data?.value;
    return typeof value === 'string' ? value : process.env[key];
  } catch {
    return process.env[key];
  }
}

export const openBaoSecrets: SecretsPort = {
  meta: {
    id: 'openbao',
    capability: 'secrets',
    vendor: 'OpenBao',
    license: 'MPL-2.0',
    render: 'embed',
    embedUrl: BAO_URL,
    description: 'KMS-backed secrets (KV v2). Admin surfaced as an SSO embed.',
  },
  get: baoGet,
  async has(key) {
    return (await baoGet(key)) !== undefined;
  },
};
