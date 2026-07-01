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

function baoHeaders(): Record<string, string> {
  return { 'X-Vault-Token': BAO_TOKEN, 'content-type': 'application/json' };
}

// Write a KV v2 secret: POST <url>/v1/<mount>/data/<key> with { data: { value } }.
async function baoSet(key: string, value: string): Promise<void> {
  if (!BAO_URL) throw new Error('OpenBao not configured (OFFGRID_OPENBAO_URL unset)');
  const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/data/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: baoHeaders(),
    body: JSON.stringify({ data: { value } }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`OpenBao write ${res.status}`);
}

// Soft-delete latest version: DELETE <url>/v1/<mount>/data/<key>.
async function baoRemove(key: string): Promise<void> {
  if (!BAO_URL) throw new Error('OpenBao not configured');
  const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/data/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: baoHeaders(),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`OpenBao delete ${res.status}`);
}

// Enumerate keys: LIST <url>/v1/<mount>/metadata (KV v2 metadata path).
async function baoList(): Promise<string[]> {
  if (!BAO_URL) return [];
  try {
    const res = await fetch(`${BAO_URL}/v1/${BAO_MOUNT}/metadata?list=true`, {
      headers: baoHeaders(),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const keys = json?.data?.keys;
    return Array.isArray(keys) ? (keys as string[]) : [];
  } catch {
    return [];
  }
}

async function baoHealth(): Promise<boolean> {
  if (!BAO_URL) return false;
  try {
    const res = await fetch(`${BAO_URL}/v1/sys/health`, { signal: AbortSignal.timeout(2500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export const openBaoSecrets: SecretsPort & { health(): Promise<boolean> } = {
  meta: {
    id: 'openbao',
    capability: 'secrets',
    vendor: 'OpenBao',
    license: 'MPL-2.0',
    render: 'embed',
    embedUrl: BAO_URL,
    description: 'KMS-backed secrets (KV v2). Read/write via API; admin surfaced as an SSO embed.',
  },
  writable: true,
  get: baoGet,
  async has(key) {
    return (await baoGet(key)) !== undefined;
  },
  set: baoSet,
  remove: baoRemove,
  list: baoList,
  health: baoHealth,
};

export function openBaoConfigured(): boolean {
  return Boolean(BAO_URL);
}
